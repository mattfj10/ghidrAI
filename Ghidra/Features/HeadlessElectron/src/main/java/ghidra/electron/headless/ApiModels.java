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

import java.time.Instant;
import java.util.*;

import com.google.gson.JsonElement;

class ApiEnvelope {
	static final String PROTOCOL_VERSION = "1.0";

	final String protocolVersion = PROTOCOL_VERSION;
	final String requestId;
	final Object data;
	final ApiError error;

	/**
	 * Wraps all API responses in a consistent protocol envelope.
	 *
	 * @param requestId request correlation ID returned to the client
	 * @param data successful response payload, or {@code null} for errors
	 * @param error structured error payload, or {@code null} for successful responses
	 */
	ApiEnvelope(String requestId, Object data, ApiError error) {
		this.requestId = requestId;
		this.data = data;
		this.error = error;
	}
}

class ApiError {
	final String code;
	final String message;
	final Object details;

	/**
	 * Creates a structured error payload for API responses.
	 *
	 * @param code stable machine-readable error code
	 * @param message human-readable error message
	 * @param details optional validation or context details
	 */
	ApiError(String code, String message, Object details) {
		this.code = code;
		this.message = message;
		this.details = details;
	}
}

class ApiException extends RuntimeException {
	final int statusCode;
	final ApiError error;

	/**
	 * Creates an API exception with no additional details.
	 *
	 * @param statusCode HTTP status code to return
	 * @param code stable machine-readable error code
	 * @param message human-readable error message
	 */
	ApiException(int statusCode, String code, String message) {
		this(statusCode, code, message, null);
	}

	/**
	 * Creates an API exception that can be translated directly into an HTTP error response.
	 *
	 * @param statusCode HTTP status code to return
	 * @param code stable machine-readable error code
	 * @param message human-readable error message
	 * @param details optional validation or context details
	 */
	ApiException(int statusCode, String code, String message, Object details) {
		super(message);
		this.statusCode = statusCode;
		this.error = new ApiError(code, message, details);
	}
}

class ProjectRecord {
	String projectId;
	String name;
	String projectDirectory;
	String projectName;
	String projectPath;
	String lastOpenedAt;
	String createdAt;
	boolean existsOnDisk;
	boolean isActive;

	/**
	 * Creates a new project record with server-managed timestamps and legacy path fields cleared.
	 *
	 * @param projectId stable server-assigned project ID
	 * @param name display name shown in the UI
	 * @param projectDirectory parent directory containing the Ghidra project
	 * @param projectName Ghidra project name
	 * @param existsOnDisk whether the project currently exists on disk
	 * @param isActive whether the project should start as active
	 * @return initialized project record
	 */
	static ProjectRecord create(String projectId, String name, String projectDirectory,
			String projectName, boolean existsOnDisk, boolean isActive) {
		ProjectRecord record = new ProjectRecord();
		record.projectId = projectId;
		record.name = name;
		record.projectDirectory = projectDirectory;
		record.projectName = projectName;
		record.projectPath = null;
		record.createdAt = Instant.now().toString();
		record.lastOpenedAt = null;
		record.existsOnDisk = existsOnDisk;
		record.isActive = isActive;
		return record;
	}
}

class ScriptSpec {
	String name;
	List<String> args = new ArrayList<>();
}

class ImportAnalyzeRequest {
	String inputPath;
	List<String> inputPaths = new ArrayList<>();
	Boolean recursive;
	Boolean readOnly;
	Boolean noAnalysis;
	Integer analysisTimeoutPerFileSec;
	Integer maxCpu;
	List<ScriptSpec> preScripts = new ArrayList<>();
	List<ScriptSpec> postScripts = new ArrayList<>();
	List<String> scriptPath = new ArrayList<>();
	List<String> propertiesPath = new ArrayList<>();
}

class CreateJobRequest extends ImportAnalyzeRequest {
	String mode;
	String projectPath;
	String projectName;
	String processPattern;
}

class CreateProjectRequest {
	String projectPath;
	String projectName;
}

class OpenProjectRequest {
	String projectId;
	String projectPath;
	String projectName;
}

class RenameProjectRequest {
	String name;
}

class JobProgress {
	String phase;
	Integer current;
	Integer total;
	Integer percent;

	/**
	 * Creates a progress snapshot for a job event or job detail response.
	 *
	 * @param phase broad execution phase
	 * @param current current item count within the phase
	 * @param total total item count within the phase
	 * @param percent optional overall completion percentage
	 */
	JobProgress(String phase, Integer current, Integer total, Integer percent) {
		this.phase = phase;
		this.current = current;
		this.total = total;
		this.percent = percent;
	}
}

class JobResult {
	Integer importedPrograms;
	Integer analyzedPrograms;
	Integer failedPrograms;
	String outputProjectPath;
}

class ArtifactRecord {
	String artifactId;
	String jobId;
	String name;
	String type;
	String contentType;
	long size;
	String createdAt;
	String downloadUrl;
	String filePath;
}

class JobRecord {
	String jobId;
	String state;
	String mode;
	String projectId;
	String createdAt;
	String startedAt;
	String finishedAt;
	ImportAnalyzeRequest request;
	JobProgress progress;
	JobResult result;
	ApiError error;
	List<String> activeArtifactIds = new ArrayList<>();
	volatile boolean cancelRequested;
}

class CapabilityResponse {
	final int maxConcurrency = 1;
	final List<String> transports = List.of("http-json", "sse");
	final List<String> projectEndpoints = List.of("list", "create", "open", "get",
		"import-and-analyze", "active-disassembly");
	final List<String> jobStates = List.of("queued", "running", "completed", "failed", "cancelled");
	final List<String> artifactTypes = List.of("log", "report", "export", "other");
}

class ServerEvent {
	final long sequence;
	final String eventType;
	final JsonElement payload;

	/**
	 * Creates a server-sent event with an assigned sequence number.
	 *
	 * @param sequence monotonically increasing event sequence
	 * @param eventType SSE event type
	 * @param payload JSON payload delivered to clients
	 */
	ServerEvent(long sequence, String eventType, JsonElement payload) {
		this.sequence = sequence;
		this.eventType = eventType;
		this.payload = payload;
	}
}

class ActiveDisassemblyResponse {
	final String projectId;
	final String binaryName;
	final String disassembly;
	final List<DisassemblyLine> lines;

	/**
	 * Creates the response body for active-project disassembly requests.
	 *
	 * @param projectId active project identifier
	 * @param binaryName requested binary/program name
	 * @param disassembly formatted text disassembly
	 * @param lines structured per-instruction disassembly data
	 */
	ActiveDisassemblyResponse(String projectId, String binaryName, String disassembly,
			List<DisassemblyLine> lines) {
		this.projectId = projectId;
		this.binaryName = binaryName;
		this.disassembly = disassembly;
		this.lines = lines;
	}
}

class DisassemblyData {
	final String disassembly;
	final List<DisassemblyLine> lines;

	/**
	 * Holds the formatted and structured disassembly returned by Ghidra operations.
	 *
	 * @param disassembly formatted text disassembly
	 * @param lines structured per-instruction line data
	 */
	DisassemblyData(String disassembly, List<DisassemblyLine> lines) {
		this.disassembly = disassembly;
		this.lines = lines;
	}
}

class DisassemblyLine {
	final String address;
	final String bytes;
	final String instruction;
	final List<InlineComment> inlineComments;

	/**
	 * Creates one structured disassembly line.
	 *
	 * @param address instruction address
	 * @param bytes formatted instruction bytes
	 * @param instruction printable instruction text
	 * @param inlineComments comments associated with the instruction line
	 */
	DisassemblyLine(String address, String bytes, String instruction, List<InlineComment> inlineComments) {
		this.address = address;
		this.bytes = bytes;
		this.instruction = instruction;
		this.inlineComments = inlineComments;
	}
}

class InlineComment {
	final String kind;
	final String text;
	final String sourceAddress;

	/**
	 * Creates an inline comment with no separate source address.
	 *
	 * @param kind comment category such as {@code EOL}, {@code AUTOMATIC}, or {@code OFFCUT}
	 * @param text comment text
	 */
	InlineComment(String kind, String text) {
		this(kind, text, null);
	}

	/**
	 * Creates an inline comment extracted from Ghidra's end-of-line comment model.
	 *
	 * @param kind comment category such as {@code EOL}, {@code AUTOMATIC}, or
	 *            {@code REFERENCED_REPEATABLE}
	 * @param text comment text
	 * @param sourceAddress optional source address for referenced comments
	 */
	InlineComment(String kind, String text, String sourceAddress) {
		this.kind = kind;
		this.text = text;
		this.sourceAddress = sourceAddress;
	}
}
