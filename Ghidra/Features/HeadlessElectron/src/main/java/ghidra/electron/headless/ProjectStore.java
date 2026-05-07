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

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.time.Instant;
import java.util.*;

import com.google.gson.reflect.TypeToken;

class ProjectStore {
	private final Path storeFile;
	private final GhidraProjectOps projectOps;
	private final EventBroker eventBroker;
	private final Map<String, ProjectRecord> projectsById = new LinkedHashMap<>();

	/**
	 * Creates a project index backed by {@code projects.json} in the server data directory.
	 *
	 * @param dataDir directory where project metadata is persisted
	 * @param projectOps Ghidra project operations used to validate and create projects
	 * @param eventBroker broker used to publish project lifecycle events
	 * @throws IOException if the data directory or project index cannot be read
	 */
	ProjectStore(Path dataDir, GhidraProjectOps projectOps, EventBroker eventBroker)
			throws IOException {
		this.storeFile = dataDir.resolve("projects.json");
		this.projectOps = projectOps;
		this.eventBroker = eventBroker;
		Files.createDirectories(dataDir);
		load();
	}

	/**
	 * Lists known projects after refreshing whether each one still exists on disk.
	 *
	 * @return projects sorted by most recently opened first
	 */
	synchronized List<ProjectRecord> listProjects() {
		refreshExistsFlags();
		List<ProjectRecord> projects = new ArrayList<>(projectsById.values());
		projects.sort(Comparator.comparing(
			(ProjectRecord p) -> Optional.ofNullable(p.lastOpenedAt).orElse("")).reversed());
		return projects;
	}

	/**
	 * Forces Ghidra initialization through the configured project operations implementation.
	 *
	 * @throws IOException if Ghidra cannot be initialized
	 */
	void ensureGhidraInitialized() throws IOException {
		projectOps.ensureGhidraInitialized();
	}

	/**
	 * Looks up a project in the persisted index.
	 *
	 * @param projectId stable project identifier assigned by the server
	 * @return matching project record with an updated existence flag
	 */
	synchronized ProjectRecord getProject(String projectId) {
		ProjectRecord project = projectsById.get(projectId);
		if (project == null) {
			throw new ApiException(404, "PROJECT_NOT_FOUND",
				"The requested project could not be found.", Map.of("projectId", projectId));
		}
		project.existsOnDisk = projectExists(project);
		return project;
	}

	/**
	 * Returns the project currently marked active for UI operations.
	 *
	 * @return active project record
	 */
	synchronized ProjectRecord getActiveProject() {
		refreshExistsFlags();
		for (ProjectRecord project : projectsById.values()) {
			if (project.isActive) {
				return project;
			}
		}
		throw new ApiException(404, "NO_ACTIVE_PROJECT",
			"No active project is currently open.");
	}

	/**
	 * Creates a new Ghidra project and adds it to the server index.
	 *
	 * @param projectDirectory parent directory where the project should be created
	 * @param projectName Ghidra project name
	 * @return stored project record for the new project
	 * @throws IOException if project creation or persistence fails
	 */
	synchronized ProjectRecord createProject(String projectDirectory, String projectName)
			throws IOException {
		projectOps.createProject(projectDirectory, projectName);
		String normalizedDirectory = normalizeProjectDirectory(projectDirectory);
		ProjectRecord record = ProjectRecord.create(nextProjectId(), projectName,
			normalizedDirectory, projectName, true, false);
		projectsById.put(record.projectId, record);
		// Verify the project actually exists on disk after creation using the original parameters
		record.existsOnDisk = projectOps.projectExists(projectDirectory, projectName);
		save();
		eventBroker.publish("project.created", Map.of("projectId", record.projectId, "timestamp",
			Instant.now().toString(), "project", record));
		return record;
	}

	/**
	 * Opens an indexed project by ID and marks it as active.
	 *
	 * @param projectId stable project identifier assigned by the server
	 * @return active project record
	 * @throws IOException if the underlying project cannot be opened
	 */
	synchronized ProjectRecord openProjectById(String projectId) throws IOException {
		ProjectRecord record = getProject(projectId);
		return activateRecord(record);
	}

	/**
	 * Opens a project by filesystem location, adding it to the index if needed.
	 *
	 * @param projectDirectory parent directory containing the Ghidra project
	 * @param projectName Ghidra project name
	 * @return active project record
	 * @throws IOException if validation or persistence fails
	 */
	synchronized ProjectRecord openProjectByPathAndName(String projectDirectory, String projectName)
			throws IOException {
		String normalizedDirectory = normalizeProjectDirectory(projectDirectory);
		ProjectRecord record = projectsById.values()
				.stream()
				.filter(p -> projectDirectory(p).equals(normalizedDirectory))
				.filter(p -> storedProjectName(p).equals(projectName))
				.findFirst()
				.orElse(null);
		if (record == null) {
			if (!projectOps.projectExists(projectDirectory, projectName)) {
				throw new ApiException(404, "PROJECT_NOT_FOUND",
					"The requested project could not be found.",
					Map.of("projectPath", logicalProjectPath(projectDirectory, projectName)));
			}
			record = ProjectRecord.create(nextProjectId(), projectName, normalizedDirectory,
				projectName, true, false);
			projectsById.put(record.projectId, record);
			// Project existence was already verified above, use the original parameters to confirm
			record.existsOnDisk = projectOps.projectExists(projectDirectory, projectName);
		}
		return activateRecord(record);
	}

	/**
	 * Validates a stored project with Ghidra, clears any previous active project, and marks this
	 * record active.
	 *
	 * @param record project record to activate
	 * @return the activated record
	 * @throws IOException if the project cannot be opened or the index cannot be saved
	 */
	private ProjectRecord activateRecord(ProjectRecord record) throws IOException {
		projectOps.validateProjectOpen(projectDirectory(record), storedProjectName(record));
		for (ProjectRecord candidate : projectsById.values()) {
			candidate.isActive = false;
		}
		record.isActive = true;
		record.lastOpenedAt = Instant.now().toString();
		record.existsOnDisk = projectExists(record);
		save();
		eventBroker.publish("project.opened", Map.of("projectId", record.projectId, "timestamp",
			record.lastOpenedAt, "project", record));
		return record;
	}

	/**
	 * Updates all indexed records with their current on-disk existence status.
	 */
	private void refreshExistsFlags() {
		for (ProjectRecord record : projectsById.values()) {
			record.existsOnDisk = projectExists(record);
		}
	}

	/**
	 * Checks whether an indexed project still exists on disk.
	 *
	 * @param record project record to inspect
	 * @return true when the corresponding project directory exists
	 */
	private boolean projectExists(ProjectRecord record) {
		return projectOps.projectExists(projectDirectory(record), storedProjectName(record));
	}

	/**
	 * Resolves the parent directory of a project from current or legacy record fields.
	 *
	 * @param record project record to resolve
	 * @return normalized absolute project parent directory
	 */
	private String projectDirectory(ProjectRecord record) {
		if (record.projectDirectory != null && !record.projectDirectory.isBlank()) {
			return normalizeProjectDirectory(record.projectDirectory);
		}
		Path projectPath = Paths.get(normalizeLegacyProjectPath(record.projectPath));
		Path parent = projectPath.getParent();
		return normalizeProjectDirectory((parent == null ? projectPath : parent).toString());
	}

	/**
	 * Resolves the Ghidra project name from current or legacy record fields.
	 *
	 * @param record project record to resolve
	 * @return stored Ghidra project name
	 */
	private String storedProjectName(ProjectRecord record) {
		if (record.projectName != null && !record.projectName.isBlank()) {
			return record.projectName;
		}
		String legacyPath = record.projectPath;
		if (legacyPath == null || legacyPath.isBlank()) {
			return record.name;
		}
		String filename = Paths.get(normalizeLegacyProjectPath(legacyPath)).getFileName().toString();
		return filename;
	}

	/**
	 * Builds a human-readable absolute project path for API error details.
	 *
	 * @param projectDirectory parent project directory
	 * @param projectName Ghidra project name
	 * @return absolute project path
	 */
	private String logicalProjectPath(String projectDirectory, String projectName) {
		return Paths.get(projectDirectory, projectName).toAbsolutePath().toString();
	}

	/**
	 * Normalizes a project parent directory to an absolute path string.
	 *
	 * @param projectDirectory directory supplied by the client or stored record
	 * @return absolute path string
	 */
	private String normalizeProjectDirectory(String projectDirectory) {
		return Paths.get(projectDirectory).toAbsolutePath().toString();
	}

	/**
	 * Converts legacy records that stored a {@code .gpr} or {@code .rep} path into the logical
	 * project directory/name form used by this API.
	 *
	 * @param projectPath legacy project path value
	 * @return path without the legacy project file suffix
	 */
	private String normalizeLegacyProjectPath(String projectPath) {
		if (projectPath.endsWith(".rep") || projectPath.endsWith(".gpr")) {
			return projectPath.substring(0, projectPath.length() - 4);
		}
		return projectPath;
	}

	/**
	 * Creates a new opaque project identifier.
	 *
	 * @return project ID suitable for API use
	 */
	private String nextProjectId() {
		return "proj_" + UUID.randomUUID().toString().replace("-", "");
	}

	/**
	 * Loads persisted project records from disk and migrates legacy entries in memory.
	 *
	 * @throws IOException if the project index exists but cannot be read
	 */
	private void load() throws IOException {
		if (!Files.exists(storeFile)) {
			return;
		}
		String json = Files.readString(storeFile, StandardCharsets.UTF_8);
		List<ProjectRecord> records = JsonSupport.GSON.fromJson(json,
			new TypeToken<List<ProjectRecord>>() {
			}.getType());
		if (records == null) {
			return;
		}
		for (ProjectRecord record : records) {
			migrateLegacyRecord(record);
			projectsById.put(record.projectId, record);
		}
	}

	/**
	 * Updates a legacy project record so current code can use project directory and name fields.
	 *
	 * @param record persisted project record to migrate
	 */
	private void migrateLegacyRecord(ProjectRecord record) {
		if ((record.projectDirectory == null || record.projectDirectory.isBlank()) &&
			record.projectPath != null && !record.projectPath.isBlank()) {
			Path legacyPath = Paths.get(normalizeLegacyProjectPath(record.projectPath));
			Path parent = legacyPath.getParent();
			record.projectDirectory =
				normalizeProjectDirectory((parent == null ? legacyPath : parent).toString());
			record.projectName = legacyPath.getFileName().toString();
		}
		if (record.projectName == null || record.projectName.isBlank()) {
			record.projectName = record.name;
		}
		if (record.name == null || record.name.isBlank()) {
			record.name = record.projectName;
		}
		record.projectPath = null;
	}

	/**
	 * Clears the remembered project index without deleting project files from disk.
	 *
	 * @throws IOException if the updated index cannot be persisted
	 */
	synchronized void clearAllProjects() throws IOException {
		projectsById.clear();
		save();
	}

	/**
	 * Removes a project from the server index without deleting the Ghidra project from disk.
	 *
	 * @param projectId project identifier to remove
	 * @throws IOException if the updated index cannot be persisted
	 */
	synchronized void deleteProject(String projectId) throws IOException {
		ProjectRecord removed = projectsById.remove(projectId);
		if (removed == null) {
			throw new ApiException(404, "PROJECT_NOT_FOUND",
				"The requested project could not be found.", Map.of("projectId", projectId));
		}
		save();
	}

	/**
	 * Renames the display name stored in the server index.
	 *
	 * @param projectId project identifier to rename
	 * @param newName new display name
	 * @return updated project record
	 * @throws IOException if the updated index cannot be persisted
	 */
	synchronized ProjectRecord renameProject(String projectId, String newName) throws IOException {
		if (newName == null || newName.isBlank()) {
			throw new ApiException(422, "VALIDATION_ERROR",
				"Project name cannot be empty.", Map.of("name", newName));
		}
		ProjectRecord record = getProject(projectId);
		record.name = newName.trim();
		save();
		return record;
	}

	/**
	 * Reads disassembly for a binary in the active project.
	 *
	 * @param binaryName name of the program file inside the active project
	 * @return formatted disassembly and structured line data
	 * @throws IOException if the active project or program cannot be read
	 */
	synchronized DisassemblyData readActiveProjectDisassembly(String binaryName) throws IOException {
		ProjectRecord active = getActiveProject();
		return projectOps.readProgramDisassembly(projectDirectory(active), storedProjectName(active),
			binaryName);
	}

	/**
	 * Persists the current project index to {@code projects.json}.
	 *
	 * @throws IOException if the index cannot be written
	 */
	private void save() throws IOException {
		List<ProjectRecord> records = new ArrayList<>(projectsById.values());
		String json = JsonSupport.GSON.toJson(records);
		Files.writeString(storeFile, json, StandardCharsets.UTF_8,
			StandardOpenOption.CREATE, StandardOpenOption.TRUNCATE_EXISTING);
	}
}
