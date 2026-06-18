import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpHandler;
import com.sun.net.httpserver.HttpServer;

import java.io.*;
import java.net.InetSocketAddress;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.*;
import java.util.stream.Collectors;

public class NUMBR {

    static class GameState {
        int targetNumber;
        int maxAttempts;
        int count;
        boolean gameOver;
        String difficulty;
        int maxRange;
        boolean withHint;
    }

    private static Map<String, GameState> sessions = new HashMap<>();
    private static List<String> highScores = new ArrayList<>();
    private static final String SCORES_FILE = "scores.json";

    public static void main(String[] args) throws IOException {
        loadScores();

        // Render.com sets PORT env variable; fallback to 8080 locally
        String portEnv = System.getenv("PORT");
        int port = (portEnv != null) ? Integer.parseInt(portEnv) : 8080;

        HttpServer server = HttpServer.create(new InetSocketAddress(port), 0);
        
        server.createContext("/api/start", new StartHandler());
        server.createContext("/api/guess", new GuessHandler());
        server.createContext("/api/scores", new ScoresHandler());
        server.createContext("/", new StaticFileHandler());
        
        server.setExecutor(null);
        System.out.println("Starting Java Backend on http://localhost:8080");
        server.start();
    }

    static class StartHandler implements HttpHandler {
        @Override
        public void handle(HttpExchange t) throws IOException {
            if ("POST".equals(t.getRequestMethod())) {
                String body = getBody(t);
                Map<String, String> params = parseQuery(body);
                String diff = params.getOrDefault("difficulty", "medium");
                boolean withHint = "true".equals(params.getOrDefault("withHint", "false"));

                int maxRange = 100;
                int maxAttempts = 7;
                if ("easy".equals(diff)) {
                    maxRange = 50; maxAttempts = 5;
                } else if ("medium".equals(diff)) {
                    maxRange = 100; maxAttempts = 7;
                } else if ("hard".equals(diff)) {
                    maxRange = 500; maxAttempts = 9;
                } else if ("expert".equals(diff)) {
                    maxRange = 1000; maxAttempts = 10;
                }

                GameState state = new GameState();
                state.maxRange = maxRange;
                state.maxAttempts = maxAttempts;
                state.targetNumber = new Random().nextInt(maxRange) + 1;
                state.count = 0;
                state.gameOver = false;
                state.difficulty = diff;
                state.withHint = withHint;

                String sessionId = UUID.randomUUID().toString();
                sessions.put(sessionId, state);

                String response = "{\"sessionId\":\"" + sessionId + "\", \"maxRange\":" + maxRange + ", \"maxAttempts\":" + maxAttempts + "}";
                sendResponse(t, 200, response);
            } else {
                sendResponse(t, 405, "Method Not Allowed");
            }
        }
    }

    static class GuessHandler implements HttpHandler {
        @Override
        public void handle(HttpExchange t) throws IOException {
            if ("POST".equals(t.getRequestMethod())) {
                String body = getBody(t);
                Map<String, String> params = parseQuery(body);
                String sessionId = params.get("sessionId");
                String guessStr = params.get("guess");

                if (sessionId == null || !sessions.containsKey(sessionId) || guessStr == null) {
                    sendResponse(t, 400, "{\"error\":\"Invalid session or guess\"}");
                    return;
                }

                GameState state = sessions.get(sessionId);
                if (state.gameOver) {
                    sendResponse(t, 400, "{\"error\":\"Game is already over\"}");
                    return;
                }

                int guess;
                try {
                    guess = Integer.parseInt(guessStr);
                } catch (Exception e) {
                    sendResponse(t, 400, "{\"error\":\"Guess must be a number\"}");
                    return;
                }

                state.count++;
                int attemptsLeft = state.maxAttempts - state.count;
                
                String status = "wrong";
                String direction = "";
                String hint = "";
                int score = 0;

                if (guess == state.targetNumber) {
                    status = "win";
                    state.gameOver = true;
                    score = Math.max(0, 100 - (state.count * 10));
                } else {
                    direction = guess > state.targetNumber ? "lower" : "higher";
                    if (attemptsLeft <= 0) {
                        status = "loss";
                        state.gameOver = true;
                    } else if (state.withHint) {
                        // Generate a random hint on every wrong guess
                        int r = new Random().nextInt(4);
                        if (r == 0) {
                            hint = "Hint: I am an " + (state.targetNumber % 2 == 0 ? "even" : "odd") + " number.";
                        } else if (r == 1) {
                            hint = "Hint: My last digit is " + (state.targetNumber % 10) + ".";
                        } else if (r == 2) {
                            boolean div3 = state.targetNumber % 3 == 0;
                            boolean div5 = state.targetNumber % 5 == 0;
                            if (div3 && div5) hint = "Hint: Number is divisible by 15.";
                            else if (div3) hint = "Hint: Number is divisible by 3.";
                            else if (div5) hint = "Hint: Number is divisible by 5.";
                            else hint = "Hint: Number is not divisible by 3 or 5.";
                        } else {
                            hint = "Hint: The number ends in a " + (state.targetNumber % 10 > 5 ? "high" : "low") + " digit (>5).";
                        }
                    }
                }

                // Construct JSON response manually
                String response = String.format(
                    "{\"status\":\"%s\", \"direction\":\"%s\", \"hint\":\"%s\", \"attemptsLeft\":%d, \"score\":%d, \"targetNumber\":%d}",
                    status, direction, hint, attemptsLeft, score, state.gameOver ? state.targetNumber : -1
                );
                
                sendResponse(t, 200, response);
            } else {
                sendResponse(t, 405, "Method Not Allowed");
            }
        }
    }

    static class ScoresHandler implements HttpHandler {
        @Override
        public void handle(HttpExchange t) throws IOException {
            if ("GET".equals(t.getRequestMethod())) {
                String jsonArr = "[" + String.join(",", highScores) + "]";
                sendResponse(t, 200, jsonArr);
            } else if ("POST".equals(t.getRequestMethod())) {
                String body = getBody(t);
                Map<String, String> params = parseQuery(body);
                String name = params.getOrDefault("name", "Anonymous");
                String scoreStr = params.get("score");
                
                if (scoreStr != null) {
                    String date = new java.text.SimpleDateFormat("MM/dd/yyyy").format(new java.util.Date());
                    // Create a simple JSON object string
                    String scoreObj = String.format("{\"name\":\"%s\", \"score\":%s, \"date\":\"%s\"}", 
                        name.replace("\"", ""), scoreStr, date);
                    
                    highScores.add(scoreObj);
                    
                    // Simple sort descending by score
                    highScores.sort((a, b) -> {
                        int scoreA = Integer.parseInt(a.split("\"score\":")[1].split(",")[0].trim());
                        int scoreB = Integer.parseInt(b.split("\"score\":")[1].split(",")[0].trim());
                        return Integer.compare(scoreB, scoreA);
                    });
                    
                    if (highScores.size() > 10) {
                        highScores = highScores.subList(0, 10);
                    }
                    saveScores();
                }
                String jsonArr = "[" + String.join(",", highScores) + "]";
                sendResponse(t, 200, jsonArr);
            }
        }
    }

    static class StaticFileHandler implements HttpHandler {
        @Override
        public void handle(HttpExchange t) throws IOException {
            String path = t.getRequestURI().getPath();
            if (path.equals("/")) {
                path = "/index.html";
            }
            // Remove leading slash for local file path
            Path filePath = Paths.get("." + path);
            if (Files.exists(filePath) && !Files.isDirectory(filePath)) {
                String mimeType = "text/plain";
                if (path.endsWith(".html")) mimeType = "text/html";
                else if (path.endsWith(".css")) mimeType = "text/css";
                else if (path.endsWith(".js")) mimeType = "application/javascript";
                else if (path.endsWith(".json")) mimeType = "application/json";
                else if (path.endsWith(".svg")) mimeType = "image/svg+xml";

                t.getResponseHeaders().set("Content-Type", mimeType);
                t.sendResponseHeaders(200, Files.size(filePath));
                try (OutputStream os = t.getResponseBody()) {
                    Files.copy(filePath, os);
                }
            } else {
                sendResponse(t, 404, "File not found");
            }
        }
    }

    // --- Helpers ---
    
    private static void sendResponse(HttpExchange t, int statusCode, String response) throws IOException {
        // Add CORS
        t.getResponseHeaders().add("Access-Control-Allow-Origin", "*");
        t.getResponseHeaders().add("Content-Type", "application/json");
        byte[] bytes = response.getBytes();
        t.sendResponseHeaders(statusCode, bytes.length);
        OutputStream os = t.getResponseBody();
        os.write(bytes);
        os.close();
    }

    private static String getBody(HttpExchange t) throws IOException {
        InputStreamReader isr = new InputStreamReader(t.getRequestBody(), "utf-8");
        BufferedReader br = new BufferedReader(isr);
        return br.lines().collect(Collectors.joining("\n"));
    }

    private static Map<String, String> parseQuery(String query) {
        Map<String, String> result = new HashMap<>();
        if (query == null || query.trim().isEmpty()) return result;
        for (String param : query.split("&")) {
            String[] entry = param.split("=");
            if (entry.length > 1) {
                try {
                    result.put(java.net.URLDecoder.decode(entry[0], "UTF-8"), 
                               java.net.URLDecoder.decode(entry[1], "UTF-8"));
                } catch (UnsupportedEncodingException e) {}
            } else {
                result.put(entry[0], "");
            }
        }
        return result;
    }

    private static void loadScores() {
        try {
            Path p = Paths.get(SCORES_FILE);
            if (Files.exists(p)) {
                String content = new String(Files.readAllBytes(p));
                if (content.startsWith("[")) {
                    // Quick and dirty manual JSON array extraction
                    content = content.substring(1, content.length() - 1);
                    if (!content.trim().isEmpty()) {
                        String[] objs = content.split("(?<=}),(?=\\{)");
                        for (String obj : objs) {
                            highScores.add(obj.trim());
                        }
                    }
                }
            }
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    private static void saveScores() {
        try {
            String jsonArr = "[\n" + String.join(",\n", highScores) + "\n]";
            Files.write(Paths.get(SCORES_FILE), jsonArr.getBytes());
        } catch (Exception e) {
            e.printStackTrace();
        }
    }
}
