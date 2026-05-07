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
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.UUID;

import com.google.gson.*;
import com.sun.net.httpserver.HttpExchange;

class JsonSupport {
	static final Gson GSON = new GsonBuilder().serializeNulls().setPrettyPrinting().create();

	private JsonSupport() {
	}

	/**
	 * Reads and deserializes a JSON request body.
	 *
	 * @param exchange active HTTP exchange containing the request body
	 * @param type model type to deserialize into
	 * @return parsed request model, or {@code null} for an empty or JSON null body
	 * @throws IOException if the request body cannot be read
	 */
	static <T> T readJson(HttpExchange exchange, Class<T> type) throws IOException {
		try (InputStream in = exchange.getRequestBody();
				InputStreamReader reader = new InputStreamReader(in, StandardCharsets.UTF_8)) {
			return GSON.fromJson(reader, type);
		}
	}

	/**
	 * Gets the caller-supplied request ID or creates one for response correlation.
	 *
	 * @param exchange active HTTP exchange
	 * @return request ID from {@code X-Request-Id}, or a generated UUID
	 */
	static String requestId(HttpExchange exchange) {
		String requestId = exchange.getRequestHeaders().getFirst("X-Request-Id");
		if (requestId == null || requestId.isBlank()) {
			return UUID.randomUUID().toString();
		}
		return requestId;
	}

	/**
	 * Writes a successful API envelope.
	 *
	 * @param exchange active HTTP exchange
	 * @param statusCode HTTP status code
	 * @param requestId response correlation ID
	 * @param data response data payload
	 * @throws IOException if the response cannot be written
	 */
	static void writeEnvelope(HttpExchange exchange, int statusCode, String requestId, Object data)
			throws IOException {
		writeJson(exchange, statusCode, new ApiEnvelope(requestId, data, null));
	}

	/**
	 * Writes an error API envelope.
	 *
	 * @param exchange active HTTP exchange
	 * @param statusCode HTTP status code
	 * @param requestId response correlation ID
	 * @param error structured API error
	 * @throws IOException if the response cannot be written
	 */
	static void writeError(HttpExchange exchange, int statusCode, String requestId, ApiError error)
			throws IOException {
		writeJson(exchange, statusCode, new ApiEnvelope(requestId, null, error));
	}

	/**
	 * Serializes an object as JSON and writes it to the HTTP response.
	 *
	 * @param exchange active HTTP exchange
	 * @param statusCode HTTP status code
	 * @param payload payload to serialize
	 * @throws IOException if the response cannot be written
	 */
	static void writeJson(HttpExchange exchange, int statusCode, Object payload) throws IOException {
		byte[] bytes = GSON.toJson(payload).getBytes(StandardCharsets.UTF_8);
		exchange.getResponseHeaders().set("Content-Type", "application/json");
		exchange.sendResponseHeaders(statusCode, bytes.length);
		try (OutputStream out = exchange.getResponseBody()) {
			out.write(bytes);
		}
	}

	/**
	 * Streams a file as an HTTP response with explicit content headers.
	 *
	 * @param exchange active HTTP exchange
	 * @param file file to stream
	 * @param contentType MIME type for the response
	 * @param dispositionType content disposition type such as {@code inline} or {@code attachment}
	 * @param fileName filename advertised to the client
	 * @throws IOException if the file cannot be read or the response cannot be written
	 */
	static void writeFile(HttpExchange exchange, Path file, String contentType, String dispositionType,
			String fileName) throws IOException {
		exchange.getResponseHeaders().set("Content-Type", contentType);
		exchange.getResponseHeaders().set("Content-Disposition",
			dispositionType + "; filename=\"" + fileName + "\"");
		exchange.sendResponseHeaders(200, Files.size(file));
		try (OutputStream out = exchange.getResponseBody()) {
			Files.copy(file, out);
		}
	}
}
