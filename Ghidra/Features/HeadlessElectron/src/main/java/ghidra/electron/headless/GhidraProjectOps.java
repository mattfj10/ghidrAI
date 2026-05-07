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
import java.nio.file.*;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Map;

import ghidra.app.util.EolComments;
import ghidra.app.util.RefRepeatComment;
import ghidra.app.util.viewer.field.EolEnablement;
import ghidra.app.util.viewer.field.EolExtraCommentsOption;
import ghidra.GhidraApplicationLayout;
import ghidra.GhidraJarApplicationLayout;
import ghidra.framework.*;
import ghidra.framework.model.DomainObject;
import ghidra.framework.model.DomainFile;
import ghidra.framework.model.DomainFolder;
import ghidra.framework.model.Project;
import ghidra.framework.model.ProjectLocator;
import ghidra.framework.project.DefaultProjectManager;
import ghidra.program.database.ProgramContentHandler;
import ghidra.program.model.listing.Instruction;
import ghidra.program.model.listing.InstructionIterator;
import ghidra.program.model.listing.Program;
import ghidra.program.model.mem.MemoryAccessException;
import ghidra.framework.store.LockException;
import ghidra.util.NotOwnerException;
import ghidra.util.exception.CancelledException;
import ghidra.util.exception.NotFoundException;
import ghidra.util.exception.VersionException;
import ghidra.util.task.TaskMonitor;

interface GhidraProjectOps {
	/**
	 * Initializes the Ghidra application runtime before any project operations are attempted.
	 *
	 * @throws IOException if Ghidra cannot be initialized
	 */
	void ensureGhidraInitialized() throws IOException;

	/**
	 * Creates a new Ghidra project.
	 *
	 * @param projectDirectory parent directory for the project
	 * @param projectName Ghidra project name
	 * @throws IOException if validation or project creation fails
	 */
	void createProject(String projectDirectory, String projectName) throws IOException;

	/**
	 * Verifies that an existing project can be opened by Ghidra.
	 *
	 * @param projectDirectory parent directory containing the project
	 * @param projectName Ghidra project name
	 * @throws IOException if the project cannot be opened
	 */
	void validateProjectOpen(String projectDirectory, String projectName) throws IOException;

	/**
	 * Checks whether a Ghidra project exists on disk.
	 *
	 * @param projectDirectory parent directory containing the project
	 * @param projectName Ghidra project name
	 * @return true when the project directory exists
	 */
	boolean projectExists(String projectDirectory, String projectName);

	/**
	 * Reads formatted and structured disassembly for a program in a project.
	 *
	 * @param projectDirectory parent directory containing the project
	 * @param projectName Ghidra project name
	 * @param programName program file name inside the project
	 * @return formatted disassembly text plus structured line data
	 * @throws IOException if the project or program cannot be read
	 */
	DisassemblyData readProgramDisassembly(String projectDirectory, String projectName,
			String programName)
			throws IOException;
}

class DefaultGhidraProjectOps implements GhidraProjectOps {
	private static final Object INIT_LOCK = new Object();

	/**
	 * Creates the default Ghidra-backed project operations implementation.
	 *
	 * @throws IOException reserved for parity with initialization callers
	 */
	DefaultGhidraProjectOps() throws IOException {
	}

	/**
	 * Ensures the Ghidra runtime has been initialized.
	 *
	 * @throws IOException if Ghidra initialization fails
	 */
	@Override
	public void ensureGhidraInitialized() throws IOException {
		ensureInitialized();
	}

	/**
	 * Creates a new project through Ghidra's project manager after validating the parent
	 * directory and collision state.
	 *
	 * @param projectDirectory parent directory for the new project
	 * @param projectName Ghidra project name
	 * @throws IOException if validation or project creation fails
	 */
	@Override
	public void createProject(String projectDirectory, String projectName) throws IOException {
		ensureInitialized();
		Path parent = Paths.get(projectDirectory);
		if (!Files.isDirectory(parent)) {
			throw new ApiException(422, "VALIDATION_ERROR", "The request failed validation.",
				Map.of("fields", Map.of("projectPath", "Directory does not exist")));
		}
		ProjectLocator locator = new ProjectLocator(parent.toString(), projectName);
		if (locator.getProjectDir().exists()) {
			throw new ApiException(409, "PROJECT_ALREADY_EXISTS",
				"A project already exists at the requested location.",
				Map.of("projectPath", locator.getProjectDir().getAbsolutePath()));
		}
		ServiceProjectManager pm = new ServiceProjectManager();
		Project project = pm.createProject(locator, null, false);
		if (project != null) {
			project.close();
		}
	}

	/**
	 * Opens and immediately closes a project to verify that it is readable by this process.
	 *
	 * @param projectDirectory parent directory containing the project
	 * @param projectName Ghidra project name
	 * @throws IOException if the project cannot be opened
	 */
	@Override
	public void validateProjectOpen(String projectDirectory, String projectName) throws IOException {
		ensureInitialized();
		ProjectLocator locator = new ProjectLocator(projectDirectory, projectName);
		if (!locator.getProjectDir().exists()) {
			throw new ApiException(404, "PROJECT_NOT_FOUND", "The requested project could not be found.",
				Map.of("projectPath", locator.getProjectDir().getAbsolutePath()));
		}
		Project project = openProject(locator);
		project.close();
	}

	/**
	 * Checks for the project directory that Ghidra uses to represent a project.
	 *
	 * @param projectDirectory parent directory containing the project
	 * @param projectName Ghidra project name
	 * @return true when the project directory exists
	 */
	@Override
	public boolean projectExists(String projectDirectory, String projectName) {
		return new ProjectLocator(projectDirectory, projectName).getProjectDir().exists();
	}

	/**
	 * Opens a project, locates a program by name, and returns its disassembly.
	 *
	 * @param projectDirectory parent directory containing the project
	 * @param projectName Ghidra project name
	 * @param programName program file name to read
	 * @return formatted disassembly text and structured line data
	 * @throws IOException if the project or program cannot be opened
	 */
	@Override
	public DisassemblyData readProgramDisassembly(String projectDirectory, String projectName,
			String programName)
			throws IOException {
		ensureInitialized();
		if (programName == null || programName.isBlank()) {
			throw new ApiException(422, "VALIDATION_ERROR", "The request failed validation.",
				Map.of("fields", Map.of("binaryName", "Binary name is required")));
		}

		ProjectLocator locator = new ProjectLocator(projectDirectory, projectName);
		Project project = openProject(locator);

		Object consumer = new Object();
		try {
			DomainFile file = findProgramFile(project.getProjectData().getRootFolder(), programName);
			if (file == null) {
				throw new ApiException(404, "BINARY_NOT_FOUND",
					"The requested binary could not be found in the active project.",
					Map.of("binaryName", programName));
			}

			try {
				DomainObject domainObject = file.getDomainObject(consumer, true, false, TaskMonitor.DUMMY);
				try {
					if (!(domainObject instanceof Program program)) {
						throw new ApiException(422, "UNSUPPORTED_BINARY",
							"The selected file is not a program and cannot be disassembled.",
							Map.of("binaryName", programName));
					}
					return formatDisassembly(program);
				}
				finally {
					domainObject.release(consumer);
				}
			}
			catch (VersionException e) {
				throw new ApiException(409, "PROGRAM_VERSION_ERROR",
					"The selected binary requires a version upgrade before disassembly.",
					Map.of("binaryName", programName, "reason", e.getMessage()));
			}
			catch (CancelledException e) {
				throw new ApiException(500, "DISASSEMBLY_CANCELLED",
					"Disassembly read was cancelled unexpectedly.",
					Map.of("binaryName", programName));
			}
		}
		finally {
			project.close();
		}
	}

	/**
	 * Opens a Ghidra project and maps framework exceptions into API errors.
	 *
	 * @param locator Ghidra project locator
	 * @return opened project that the caller must close
	 * @throws IOException if the project cannot be opened
	 */
	private Project openProject(ProjectLocator locator) throws IOException {
		ServiceProjectManager pm = new ServiceProjectManager();
		try {
			return pm.openProject(locator, false, false);
		}
		catch (NotFoundException e) {
			throw new ApiException(404, "PROJECT_NOT_FOUND",
				"The requested project could not be found.",
				Map.of("projectPath", locator.getProjectDir().getAbsolutePath()));
		}
		catch (NotOwnerException | LockException e) {
			throw new ApiException(409, "PROJECT_NOT_FOUND",
				"The requested project could not be opened.",
				Map.of("projectPath", locator.getProjectDir().getAbsolutePath(), "reason",
					e.getMessage()));
		}
	}

	/**
	 * Finds a program file by name, preferring exact matches before case-insensitive matches.
	 *
	 * @param folder folder tree to search
	 * @param programName requested program file name
	 * @return matching domain file, or {@code null} when absent
	 */
	private DomainFile findProgramFile(DomainFolder folder, String programName) {
		DomainFile exactMatch = findProgramFile(folder, programName, false);
		if (exactMatch != null) {
			return exactMatch;
		}
		return findProgramFile(folder, programName, true);
	}

	/**
	 * Recursively searches a folder tree for a program domain file.
	 *
	 * @param folder current folder to search
	 * @param programName requested program file name
	 * @param ignoreCase whether to compare names case-insensitively
	 * @return matching domain file, or {@code null} when absent
	 */
	private DomainFile findProgramFile(DomainFolder folder, String programName, boolean ignoreCase) {
		for (DomainFile file : folder.getFiles()) {
			if (!ProgramContentHandler.PROGRAM_CONTENT_TYPE.equals(file.getContentType())) {
				continue;
			}
			if (ignoreCase ? file.getName().equalsIgnoreCase(programName)
					: file.getName().equals(programName)) {
				return file;
			}
		}
		for (DomainFolder child : folder.getFolders()) {
			DomainFile found = findProgramFile(child, programName, ignoreCase);
			if (found != null) {
				return found;
			}
		}
		return null;
	}

	/**
	 * Converts all instructions in a program into the API's text and line-oriented disassembly
	 * model.
	 *
	 * @param program opened Ghidra program
	 * @return disassembly text and per-instruction structured data
	 */
	private DisassemblyData formatDisassembly(Program program) {
		StringBuilder out = new StringBuilder();
		List<DisassemblyLine> lines = new ArrayList<>();
		out.append("; Program: ").append(program.getName()).append(System.lineSeparator());
		out.append("; Address").append("            ").append("Bytes")
			.append("                    ").append("Instruction")
			.append(System.lineSeparator()).append(System.lineSeparator());

		InstructionIterator instructions = program.getListing().getInstructions(true);
		int count = 0;
		while (instructions.hasNext()) {
			Instruction instruction = instructions.next();
			String address = instruction.getAddress().toString();
			String bytes;
			try {
				bytes = toHex(instruction.getBytes());
			}
			catch (MemoryAccessException e) {
				bytes = "<unavailable>";
			}
			String instructionText = instruction.toString();
			out.append(String.format("%-18s %-24s %s%n", address, bytes, instructionText));
			lines.add(new DisassemblyLine(address, bytes, instructionText,
				extractInlineComments(instruction)));
			count++;
		}
		if (count == 0) {
			out.append("; No instructions found in this program.").append(System.lineSeparator());
		}
		return new DisassemblyData(out.toString(), lines);
	}

	/**
	 * Extracts the inline comments Ghidra would show at the end of an instruction line.
	 *
	 * @param instruction instruction whose comments should be collected
	 * @return inline comments grouped by API comment kind
	 */
	private List<InlineComment> extractInlineComments(Instruction instruction) {
		List<InlineComment> comments = new ArrayList<>();
		EolComments eolComments = new EolComments(instruction, true, Integer.MAX_VALUE,
			createEolOptions());

		addCommentLines(comments, "EOL", eolComments.getEOLComments(), null);
		addCommentLines(comments, "REPEATABLE", eolComments.getRepeatableComments(), null);
		for (RefRepeatComment refComment : eolComments.getReferencedRepeatableComments()) {
			String sourceAddress = refComment.getAddress() != null ? refComment.getAddress().toString() : null;
			addCommentLines(comments, "REFERENCED_REPEATABLE",
				Arrays.asList(refComment.getCommentLines()), sourceAddress);
		}
		addCommentLines(comments, "AUTOMATIC", eolComments.getAutomaticComment(), null);
		addCommentLines(comments, "OFFCUT", eolComments.getOffcutEolComments(), null);
		return comments;
	}

	/**
	 * Adds non-blank comment lines to a structured comment list.
	 *
	 * @param out destination comment list
	 * @param kind API comment kind such as {@code EOL} or {@code AUTOMATIC}
	 * @param lines raw comment lines from Ghidra
	 * @param sourceAddress optional source address for referenced repeatable comments
	 */
	private void addCommentLines(List<InlineComment> out, String kind, List<String> lines,
			String sourceAddress) {
		for (String line : lines) {
			if (line == null || line.isBlank()) {
				continue;
			}
			out.add(new InlineComment(kind, line, sourceAddress));
		}
	}

	/**
	 * Builds comment display options that include the extra inline comment categories used by the
	 * code browser.
	 *
	 * @return configured end-of-line comment options
	 */
	private EolExtraCommentsOption createEolOptions() {
		EolExtraCommentsOption options = new EolExtraCommentsOption();
		options.setRepeatable(EolEnablement.ALWAYS);
		options.setRefRepeatable(EolEnablement.ALWAYS);
		options.setAutoData(EolEnablement.ALWAYS);
		options.setAutoFunction(EolEnablement.ALWAYS);
		return options;
	}

	/**
	 * Formats instruction bytes as uppercase hexadecimal pairs separated by spaces.
	 *
	 * @param bytes raw instruction bytes
	 * @return printable byte string, or an empty string for no bytes
	 */
	private String toHex(byte[] bytes) {
		if (bytes == null || bytes.length == 0) {
			return "";
		}
		StringBuilder sb = new StringBuilder(bytes.length * 3);
		for (int i = 0; i < bytes.length; i++) {
			if (i > 0) {
				sb.append(' ');
			}
			sb.append(String.format("%02X", bytes[i] & 0xff));
		}
		return sb.toString();
	}

	/**
	 * Initializes the Ghidra application runtime once for the JVM.
	 *
	 * @throws IOException if no usable Ghidra application layout can be created
	 */
	private static void ensureInitialized() throws IOException {
		if (Application.isInitialized()) {
			return;
		}
		synchronized (INIT_LOCK) {
			if (Application.isInitialized()) {
				return;
			}
			System.setProperty("java.awt.headless", "true");
			GhidraApplicationLayout layout;
			try {
				layout = new GhidraApplicationLayout();
			}
			catch (IOException e) {
				layout = new GhidraJarApplicationLayout();
			}
			HeadlessGhidraApplicationConfiguration config =
				new HeadlessGhidraApplicationConfiguration();
			config.setInitializeLogging(false);
			Application.initializeApplication(layout, config);
		}
	}

	private static class ServiceProjectManager extends DefaultProjectManager {
		// Intentionally empty; exists only to expose the protected constructor.
	}
}
