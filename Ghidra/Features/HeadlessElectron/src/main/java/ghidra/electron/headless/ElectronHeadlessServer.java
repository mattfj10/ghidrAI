/* ###
 * IP: GHIDRA
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
package ghidra.electron.headless;

import java.io.*;
import java.net.InetSocketAddress;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.*;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;

public class ElectronHeadlessServer {
	private final HttpServer server;
	private final EventBroker eventBroker;
	private final ProjectStore projectStore;
	private final HeadlessJobManager jobManager;
	private final ArtifactStore artifactStore;

	/**
	 * Creates the production HTTP server used by the Electron frontend.
	 *
	 * @param port local loopback port to bind, or {@code 0} to let the OS choose one
	 * @param dataDir directory used for persisted project, job, and artifact metadata
	 * @param repoRoot root of the Ghidra checkout containing the headless runtime scripts
	 * @throws IOException if the server or backing stores cannot be created
	 */
	public ElectronHeadlessServer(int port, Path dataDir, Path repoRoot) throws IOException {
		this(new EventBroker(), dataDir, port, new DefaultGhidraProjectOps(),
			new ScriptProcessExecutionEngine(repoRoot));
	}

	/**
	 * Creates a server with injectable collaborators for tests and alternate runtimes.
	 *
	 * @param eventBroker broker used for server-sent project, job, and artifact events
	 * @param dataDir directory used for persisted backend state
	 * @param port local loopback port to bind
	 * @param projectOps implementation that performs Ghidra project operations
	 * @param engine implementation that executes headless import/analyze jobs
	 * @throws IOException if the HTTP server or stores cannot be initialized
	 */
	ElectronHeadlessServer(EventBroker eventBroker, Path dataDir, int port, GhidraProjectOps projectOps,
			HeadlessExecutionEngine engine) throws IOException {
		this.eventBroker = eventBroker;
		this.artifactStore = new ArtifactStore(dataDir, eventBroker);
		this.projectStore = new ProjectStore(dataDir, projectOps, eventBroker);
		this.jobManager = new HeadlessJobManager(dataDir, artifactStore, eventBroker, engine);

		server = HttpServer.create(new InetSocketAddress("127.0.0.1", port), 0);
		server.setExecutor(Executors.newCachedThreadPool());
		server.createContext("/api/v1/health", this::handleHealth);
		server.createContext("/api/v1/capabilities", this::handleCapabilities);
		server.createContext("/api/v1/projects/active/disassembly", this::handleActiveDisassembly);
		server.createContext("/api/v1/projects", this::handleProjects);
		server.createContext("/api/v1/jobs", this::handleJobs);
		server.createContext("/api/v1/events", this::handleEvents);
	}

	/**
	 * Initializes Ghidra and starts accepting HTTP requests.
	 *
	 * @throws IOException if Ghidra initialization fails or the HTTP server cannot start
	 */
	public void start() throws IOException {
		// Initialize Ghidra before starting the HTTP server so the first create/open
		// project request does not block for 30-60+ seconds. The launch script waits
		// for /api/v1/health before opening the Electron window, so the user sees the
		// UI only after Ghidra is ready.
		try {
			projectStore.ensureGhidraInitialized();
		}
		catch (IOException e) {
			throw e;
		}
		catch (Exception e) {
			throw new IOException("Ghidra initialization failed", e);
		}
		server.start();
	}

	/**
	 * Returns the bound TCP port, including the assigned port when the server was created with
	 * {@code port == 0}.
	 *
	 * @return the local port currently used by the HTTP server
	 */
	int getPort() {
		return server.getAddress().getPort();
	}

	/**
	 * Stops background job execution and closes the HTTP listener.
	 */
	public void stop() {
		jobManager.shutdown();
		server.stop(0);
	}

	/**
	 * Handles the health endpoint used by launch scripts and the frontend to detect readiness.
	 *
	 * @param exchange active HTTP exchange for {@code /api/v1/health}
	 * @throws IOException if the response cannot be written
	 */
	private void handleHealth(HttpExchange exchange) throws IOException {
		String requestId = JsonSupport.requestId(exchange);
		JsonSupport.writeEnvelope(exchange, 200, requestId,
			Map.of("status", "ok", "protocolVersion", ApiEnvelope.PROTOCOL_VERSION));
	}

	/**
	 * Returns static protocol capabilities so the frontend can adapt to supported operations.
	 *
	 * @param exchange active HTTP exchange for {@code /api/v1/capabilities}
	 * @throws IOException if the response cannot be written
	 */
	private void handleCapabilities(HttpExchange exchange) throws IOException {
		String requestId = JsonSupport.requestId(exchange);
		JsonSupport.writeEnvelope(exchange, 200, requestId, new CapabilityResponse());
	}

	/**
	 * Reads disassembly for a binary in the currently active project.
	 *
	 * @param exchange active HTTP exchange for
	 *            {@code /api/v1/projects/active/disassembly?binaryName=...}
	 * @throws IOException if request or response I/O fails
	 */
	private void handleActiveDisassembly(HttpExchange exchange) throws IOException {
		if (!"GET".equals(exchange.getRequestMethod())) {
			exchange.sendResponseHeaders(405, -1);
			return;
		}
		String requestId = JsonSupport.requestId(exchange);
		try {
			String binaryName = queryParam(exchange.getRequestURI().getRawQuery(), "binaryName");
			if (binaryName == null || binaryName.isBlank()) {
				throw new ApiException(422, "VALIDATION_ERROR", "The request failed validation.",
					Map.of("fields", Map.of("binaryName", "Query parameter is required")));
			}
			DisassemblyData disassemblyData = projectStore.readActiveProjectDisassembly(binaryName);
			ProjectRecord active = projectStore.getActiveProject();
			JsonSupport.writeEnvelope(exchange, 200, requestId, new ActiveDisassemblyResponse(
				active.projectId, binaryName, disassemblyData.disassembly, disassemblyData.lines));
		}
		catch (ApiException e) {
			JsonSupport.writeError(exchange, e.statusCode, requestId, e.error);
		}
		catch (Exception e) {
			JsonSupport.writeError(exchange, 500, requestId,
				new ApiError("INTERNAL_ERROR", e.getMessage(), null));
		}
	}

	/**
	 * Routes project endpoints for listing, creating, opening, renaming, deleting, and importing
	 * into projects.
	 *
	 * @param exchange active HTTP exchange under {@code /api/v1/projects}
	 * @throws IOException if request parsing or response writing fails
	 */
	private void handleProjects(HttpExchange exchange) throws IOException {
		String requestId = JsonSupport.requestId(exchange);
		try {
			String path = exchange.getRequestURI().getPath();
			String method = exchange.getRequestMethod();
			if ("/api/v1/projects".equals(path)) {
				if ("DELETE".equals(method)) {
					try {
						projectStore.clearAllProjects();
						JsonSupport.writeEnvelope(exchange, 200, requestId,
							Map.of("cleared", true, "message", "All projects cleared from index"));
					} catch (IOException e) {
						throw new ApiException(500, "CLEAR_FAILED",
							"Failed to clear projects: " + e.getMessage(), null);
					}
					return;
				}
				if ("GET".equals(method)) {
					JsonSupport.writeEnvelope(exchange, 200, requestId,
						Map.of("projects", projectStore.listProjects()));
					return;
				}
				if ("POST".equals(method)) {
					CreateProjectRequest request =
						Objects.requireNonNull(JsonSupport.readJson(exchange, CreateProjectRequest.class));
					ProjectRecord project =
						projectStore.createProject(request.projectPath, request.projectName);
					JsonSupport.writeEnvelope(exchange, 201, requestId,
						Map.of("project", project, "created", true));
					return;
				}
			}
			if ("/api/v1/projects/open".equals(path) && "POST".equals(method)) {
				OpenProjectRequest request =
					Objects.requireNonNull(JsonSupport.readJson(exchange, OpenProjectRequest.class));
				ProjectRecord project = openProject(request);
				JsonSupport.writeEnvelope(exchange, 200, requestId,
					Map.of("project", project, "opened", true));
				return;
			}
			if ("/api/v1/jobs".equals(path) && "POST".equals(method)) {
				CreateJobRequest request =
					Objects.requireNonNull(JsonSupport.readJson(exchange, CreateJobRequest.class));
				if (request.mode != null && !"import".equals(request.mode)) {
					throw new ApiException(422, "UNSUPPORTED_OPTION",
						"Only mode=import is supported in v1.",
						Map.of("mode", request.mode));
				}
				ProjectRecord project =
					projectStore.openProjectByPathAndName(request.projectPath, request.projectName);
				ImportAnalyzeRequest importRequest = new ImportAnalyzeRequest();
				importRequest.inputPath = request.inputPath;
				importRequest.inputPaths =
					request.inputPaths != null ? new ArrayList<>(request.inputPaths) : null;
				importRequest.recursive = request.recursive;
				importRequest.readOnly = request.readOnly;
				importRequest.noAnalysis = request.noAnalysis;
				importRequest.analysisTimeoutPerFileSec = request.analysisTimeoutPerFileSec;
				importRequest.maxCpu = request.maxCpu;
				importRequest.preScripts = request.preScripts;
				importRequest.postScripts = request.postScripts;
				importRequest.scriptPath = request.scriptPath;
				importRequest.propertiesPath = request.propertiesPath;
				JobRecord job = jobManager.submitImportAnalyze(project, importRequest);
				JsonSupport.writeEnvelope(exchange, 202, requestId, Map.of("job", jobSummary(job)));
				return;
			}
			if (path.startsWith("/api/v1/projects/")) {
				String suffix = path.substring("/api/v1/projects/".length());
				if (suffix.endsWith("/import-and-analyze") && "POST".equals(method)) {
					String projectId =
						suffix.substring(0, suffix.length() - "/import-and-analyze".length());
					ImportAnalyzeRequest request =
						Objects.requireNonNull(JsonSupport.readJson(exchange, ImportAnalyzeRequest.class));
					ProjectRecord project = projectStore.getProject(projectId);
					JobRecord job = jobManager.submitImportAnalyze(project, request);
					JsonSupport.writeEnvelope(exchange, 202, requestId, Map.of("job", jobSummary(job)));
					return;
				}
				if ("GET".equals(method) && !suffix.contains("/")) {
					JsonSupport.writeEnvelope(exchange, 200, requestId,
						Map.of("project", projectStore.getProject(suffix)));
					return;
				}
				if ("DELETE".equals(method) && !suffix.contains("/")) {
					projectStore.deleteProject(suffix);
					JsonSupport.writeEnvelope(exchange, 200, requestId,
						Map.of("deleted", true, "projectId", suffix));
					return;
				}
				if ("PATCH".equals(method) && !suffix.contains("/")) {
					RenameProjectRequest request =
						Objects.requireNonNull(JsonSupport.readJson(exchange, RenameProjectRequest.class));
					ProjectRecord project = projectStore.renameProject(suffix, request.name);
					JsonSupport.writeEnvelope(exchange, 200, requestId,
						Map.of("project", project, "renamed", true));
					return;
				}
			}
			throw new ApiException(404, "INVALID_REQUEST", "Unknown project endpoint.");
		}
		catch (ApiException e) {
			JsonSupport.writeError(exchange, e.statusCode, requestId, e.error);
		}
		catch (Exception e) {
			JsonSupport.writeError(exchange, 500, requestId,
				new ApiError("INTERNAL_ERROR", e.getMessage(), null));
		}
	}

	/**
	 * Opens a project from an API request using exactly one selector style.
	 *
	 * @param request request containing either {@code projectId} or {@code projectPath} plus
	 *            {@code projectName}
	 * @return the active project record after validation
	 * @throws IOException if the selected project cannot be opened
	 */
	private ProjectRecord openProject(OpenProjectRequest request) throws IOException {
		boolean hasId = request.projectId != null && !request.projectId.isBlank();
		boolean hasPath = request.projectPath != null && request.projectName != null &&
			!request.projectPath.isBlank() && !request.projectName.isBlank();
		if (hasId == hasPath) {
			throw new ApiException(422, "VALIDATION_ERROR", "The request failed validation.",
				Map.of("fields", Map.of("projectSelector",
					"Specify exactly one selector style")));
		}
		return hasId ? projectStore.openProjectById(request.projectId)
				: projectStore.openProjectByPathAndName(request.projectPath, request.projectName);
	}

	/**
	 * Routes job endpoints for cancellation, artifact listing/download, and job detail lookup.
	 *
	 * @param exchange active HTTP exchange under {@code /api/v1/jobs}
	 * @throws IOException if request parsing or response writing fails
	 */
	private void handleJobs(HttpExchange exchange) throws IOException {
		String requestId = JsonSupport.requestId(exchange);
		try {
			String path = exchange.getRequestURI().getPath();
			String method = exchange.getRequestMethod();
			if (path.startsWith("/api/v1/jobs/")) {
				String suffix = path.substring("/api/v1/jobs/".length());
				if (suffix.endsWith("/cancel") && "POST".equals(method)) {
					String jobId = suffix.substring(0, suffix.length() - "/cancel".length());
					jobManager.cancelJob(jobId);
					JsonSupport.writeEnvelope(exchange, 202, requestId,
						Map.of("jobId", jobId, "cancelRequested", true));
					return;
				}
				if (suffix.endsWith("/artifacts") && "GET".equals(method)) {
					String jobId = suffix.substring(0, suffix.length() - "/artifacts".length());
					JsonSupport.writeEnvelope(exchange, 200, requestId,
						Map.of("jobId", jobId, "artifacts", sanitize(jobManager.listArtifacts(jobId))));
					return;
				}
				if (suffix.contains("/artifacts/") && "GET".equals(method)) {
					String[] parts = suffix.split("/artifacts/", 2);
					ArtifactRecord artifact = jobManager.getArtifact(parts[0], parts[1]);
					String disposition =
						artifact.contentType.startsWith("text/") ? "inline" : "attachment";
					JsonSupport.writeFile(exchange, Paths.get(artifact.filePath), artifact.contentType,
						disposition, artifact.name);
					return;
				}
				if ("GET".equals(method) && !suffix.contains("/")) {
					JsonSupport.writeEnvelope(exchange, 200, requestId,
						Map.of("job", jobDetail(jobManager.getJob(suffix))));
					return;
				}
			}
			throw new ApiException(404, "INVALID_REQUEST", "Unknown job endpoint.");
		}
		catch (ApiException e) {
			JsonSupport.writeError(exchange, e.statusCode, requestId, e.error);
		}
		catch (Exception e) {
			JsonSupport.writeError(exchange, 500, requestId,
				new ApiError("INTERNAL_ERROR", e.getMessage(), null));
		}
	}

	/**
	 * Streams backend events to the frontend using server-sent events.
	 *
	 * @param exchange active HTTP exchange for {@code /api/v1/events}
	 * @throws IOException if the stream cannot be opened or written
	 */
	private void handleEvents(HttpExchange exchange) throws IOException {
		String requestId = JsonSupport.requestId(exchange);
		try {
			long since = parseSince(exchange.getRequestURI().getRawQuery());
			EventBroker.EventSubscription subscription = eventBroker.subscribe(since);
			exchange.getResponseHeaders().set("Content-Type", "text/event-stream");
			exchange.getResponseHeaders().set("Cache-Control", "no-cache");
			exchange.getResponseHeaders().set("X-Request-Id", requestId);
			exchange.sendResponseHeaders(200, 0);
			try (OutputStream out = exchange.getResponseBody(); subscription) {
				while (true) {
					ServerEvent event = subscription.poll(15, TimeUnit.SECONDS);
					if (event == null) {
						out.write(": ping\n\n".getBytes(StandardCharsets.UTF_8));
						out.flush();
						continue;
					}
					String frame = "id: " + event.sequence + "\n" + "event: " + event.eventType + "\n" +
						"data: " + JsonSupport.GSON.toJson(event.payload) + "\n\n";
					out.write(frame.getBytes(StandardCharsets.UTF_8));
					out.flush();
				}
			}
		}
		catch (ApiException e) {
			JsonSupport.writeError(exchange, e.statusCode, requestId, e.error);
		}
		catch (InterruptedException e) {
			Thread.currentThread().interrupt();
		}
		catch (IOException ignored) {
			// client disconnected
		}
	}

	/**
	 * Parses the optional event replay cursor from a query string.
	 *
	 * @param rawQuery raw URI query string
	 * @return requested event sequence cursor, or {@code 0} when no cursor is supplied
	 */
	private long parseSince(String rawQuery) {
		if (rawQuery == null || rawQuery.isBlank()) {
			return 0;
		}
		for (String pair : rawQuery.split("&")) {
			String[] parts = pair.split("=", 2);
			if (parts.length == 2 && "since".equals(parts[0])) {
				try {
					return Long.parseLong(parts[1]);
				}
				catch (NumberFormatException e) {
					throw new ApiException(400, "INVALID_REQUEST", "Invalid since cursor value.");
				}
			}
		}
		return 0;
	}

	/**
	 * Extracts and URL-decodes a single query parameter.
	 *
	 * @param rawQuery raw URI query string
	 * @param key parameter name to read
	 * @return decoded parameter value, or {@code null} when absent
	 */
	private String queryParam(String rawQuery, String key) {
		if (rawQuery == null || rawQuery.isBlank()) {
			return null;
		}
		for (String pair : rawQuery.split("&")) {
			String[] parts = pair.split("=", 2);
			if (parts.length == 2 && key.equals(parts[0])) {
				return URLDecoder.decode(parts[1], StandardCharsets.UTF_8);
			}
		}
		return null;
	}

	/**
	 * Produces the public artifact view returned by list endpoints, excluding local filesystem
	 * paths.
	 *
	 * @param records artifact records from the job manager
	 * @return serializable artifact summaries
	 */
	private Object sanitize(List<ArtifactRecord> records) {
		return records.stream().map(a -> Map.of("artifactId", a.artifactId, "jobId", a.jobId, "name",
			a.name, "type", a.type, "contentType", a.contentType, "size", a.size, "createdAt",
			a.createdAt, "downloadUrl", a.downloadUrl)).toList();
	}

	/**
	 * Produces the compact job view returned immediately after submission.
	 *
	 * @param job newly created job record
	 * @return serializable job summary
	 */
	private Object jobSummary(JobRecord job) {
		return Map.of("jobId", job.jobId, "state", job.state, "mode", job.mode, "projectId",
			job.projectId, "createdAt", job.createdAt);
	}

	/**
	 * Produces the detailed job view returned by job lookup endpoints.
	 *
	 * @param job stored job record
	 * @return serializable job detail including progress, result, error, and artifact IDs
	 */
	private Object jobDetail(JobRecord job) {
		Map<String, Object> view = new LinkedHashMap<>();
		view.put("jobId", job.jobId);
		view.put("state", job.state);
		view.put("mode", job.mode);
		view.put("projectId", job.projectId);
		view.put("createdAt", job.createdAt);
		view.put("startedAt", job.startedAt);
		view.put("finishedAt", job.finishedAt);
		view.put("request", job.request);
		view.put("progress", job.progress);
		view.put("result", job.result);
		view.put("error", job.error);
		view.put("activeArtifactIds", job.activeArtifactIds);
		return view;
	}

	/**
	 * Resolves the default backend data directory from the environment or the user's home
	 * directory.
	 *
	 * @return directory used for persisted server state
	 */
	private static Path defaultDataDir() {
		String configured = System.getenv("GHIDRA_ELECTRON_DATA_DIR");
		if (configured != null && !configured.isBlank()) {
			return Paths.get(configured);
		}
		return Paths.get(System.getProperty("user.home"), ".ghidra-electron-headless");
	}

	/**
	 * Locates the Ghidra repository root used to launch {@code analyzeHeadless}.
	 *
	 * @return configured or discovered repository root
	 * @throws IllegalStateException if no repository root can be discovered
	 */
	private static Path findRepoRoot() {
		String configured = System.getenv("GHIDRA_REPO");
		if (configured != null && !configured.isBlank()) {
			return Paths.get(configured);
		}
		Path current = Paths.get("").toAbsolutePath();
		for (Path candidate = current; candidate != null; candidate = candidate.getParent()) {
			if (Files.exists(candidate.resolve("Ghidra/RuntimeScripts/Linux/support/analyzeHeadless")) &&
				Files.exists(candidate.resolve("settings.gradle"))) {
				return candidate;
			}
		}
		throw new IllegalStateException("Unable to determine GHIDRA_REPO. Set GHIDRA_REPO explicitly.");
	}

	/**
	 * Starts the backend directly from Java for local development and launcher scripts.
	 *
	 * @param args ignored; configuration is read from environment variables
	 * @throws Exception if server construction or startup fails
	 */
	public static void main(String[] args) throws Exception {
		int port = Integer.parseInt(System.getenv().getOrDefault("GHIDRA_ELECTRON_PORT", "8089"));
		ElectronHeadlessServer server =
			new ElectronHeadlessServer(port, defaultDataDir(), findRepoRoot());
		server.start();
		System.out.println("Headless Electron backend listening at http://127.0.0.1:" + port);
	}
}
