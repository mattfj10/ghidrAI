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

	ProjectStore(Path dataDir, GhidraProjectOps projectOps, EventBroker eventBroker)
			throws IOException {
		this.storeFile = dataDir.resolve("projects.json");
		this.projectOps = projectOps;
		this.eventBroker = eventBroker;
		Files.createDirectories(dataDir);
		load();
	}

	synchronized List<ProjectRecord> listProjects() {
		refreshExistsFlags();
		List<ProjectRecord> projects = new ArrayList<>(projectsById.values());
		projects.sort(Comparator.comparing(
			(ProjectRecord p) -> Optional.ofNullable(p.lastOpenedAt).orElse("")).reversed());
		return projects;
	}

	void ensureGhidraInitialized() throws IOException {
		projectOps.ensureGhidraInitialized();
	}

	synchronized ProjectRecord getProject(String projectId) {
		ProjectRecord project = projectsById.get(projectId);
		if (project == null) {
			throw new ApiException(404, "PROJECT_NOT_FOUND",
				"The requested project could not be found.", Map.of("projectId", projectId));
		}
		project.existsOnDisk = projectExists(project);
		return project;
	}

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

	synchronized ProjectRecord openProjectById(String projectId) throws IOException {
		ProjectRecord record = getProject(projectId);
		return activateRecord(record);
	}

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

	private void refreshExistsFlags() {
		for (ProjectRecord record : projectsById.values()) {
			record.existsOnDisk = projectExists(record);
		}
	}

	private boolean projectExists(ProjectRecord record) {
		return projectOps.projectExists(projectDirectory(record), storedProjectName(record));
	}

	private String projectDirectory(ProjectRecord record) {
		if (record.projectDirectory != null && !record.projectDirectory.isBlank()) {
			return normalizeProjectDirectory(record.projectDirectory);
		}
		Path projectPath = Paths.get(normalizeLegacyProjectPath(record.projectPath));
		Path parent = projectPath.getParent();
		return normalizeProjectDirectory((parent == null ? projectPath : parent).toString());
	}

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

	private String logicalProjectPath(String projectDirectory, String projectName) {
		return Paths.get(projectDirectory, projectName).toAbsolutePath().toString();
	}

	private String normalizeProjectDirectory(String projectDirectory) {
		return Paths.get(projectDirectory).toAbsolutePath().toString();
	}

	private String normalizeLegacyProjectPath(String projectPath) {
		if (projectPath.endsWith(".rep") || projectPath.endsWith(".gpr")) {
			return projectPath.substring(0, projectPath.length() - 4);
		}
		return projectPath;
	}

	private String nextProjectId() {
		return "proj_" + UUID.randomUUID().toString().replace("-", "");
	}

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

	synchronized void clearAllProjects() throws IOException {
		projectsById.clear();
		save();
	}

	synchronized void deleteProject(String projectId) throws IOException {
		ProjectRecord removed = projectsById.remove(projectId);
		if (removed == null) {
			throw new ApiException(404, "PROJECT_NOT_FOUND",
				"The requested project could not be found.", Map.of("projectId", projectId));
		}
		save();
	}

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

	synchronized DisassemblyData readActiveProjectDisassembly(String binaryName) throws IOException {
		ProjectRecord active = getActiveProject();
		return projectOps.readProgramDisassembly(projectDirectory(active), storedProjectName(active),
			binaryName);
	}

	private void save() throws IOException {
		List<ProjectRecord> records = new ArrayList<>(projectsById.values());
		String json = JsonSupport.GSON.toJson(records);
		Files.writeString(storeFile, json, StandardCharsets.UTF_8,
			StandardOpenOption.CREATE, StandardOpenOption.TRUNCATE_EXISTING);
	}
}
