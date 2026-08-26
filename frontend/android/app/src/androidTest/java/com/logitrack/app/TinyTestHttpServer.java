package com.logitrack.app;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Serveur HTTP minimal pour les tests instrumentés (Phase 4, PositionUploadWorker)
 * — PAS une dépendance de test (MockWebServer/WireMock indisponibles dans ce
 * projet) : un ServerSocket + un parseur HTTP/1.1 volontairement basique,
 * suffisant pour répondre un code HTTP fixe à chaque requête POST reçue.
 * Vit uniquement dans androidTest, jamais embarqué dans l'app.
 */
final class TinyTestHttpServer {

    private final ServerSocket serverSocket;
    private final Thread acceptThread;
    private volatile boolean running = true;
    private final AtomicInteger requestCount = new AtomicInteger(0);
    private volatile int responseStatus;

    TinyTestHttpServer(int responseStatus) throws IOException {
        this.responseStatus = responseStatus;
        this.serverSocket = new ServerSocket(0); // 0 = port libre choisi par l'OS
        this.acceptThread = new Thread(this::acceptLoop, "tiny-test-http-server");
        this.acceptThread.setDaemon(true);
        this.acceptThread.start();
    }

    int getPort() {
        return serverSocket.getLocalPort();
    }

    int getRequestCount() {
        return requestCount.get();
    }

    void setResponseStatus(int status) {
        this.responseStatus = status;
    }

    private void acceptLoop() {
        while (running) {
            try {
                Socket socket = serverSocket.accept();
                handleConnection(socket);
            } catch (IOException e) {
                if (running) {
                    // Le socket a pu être fermé par stop() pendant accept() — attendu, on sort.
                }
            }
        }
    }

    private void handleConnection(Socket socket) {
        try (Socket s = socket) {
            BufferedReader reader = new BufferedReader(
                new InputStreamReader(s.getInputStream(), StandardCharsets.UTF_8));
            String line;
            int contentLength = 0;
            // Ligne de requête + en-têtes, jusqu'à la ligne vide.
            while ((line = reader.readLine()) != null && !line.isEmpty()) {
                if (line.toLowerCase().startsWith("content-length:")) {
                    contentLength = Integer.parseInt(line.substring(line.indexOf(':') + 1).trim());
                }
            }
            // Corps (non utilisé par les tests, juste consommé pour ne pas bloquer le client).
            char[] bodyBuf = new char[contentLength];
            int readTotal = 0;
            while (readTotal < contentLength) {
                int n = reader.read(bodyBuf, readTotal, contentLength - readTotal);
                if (n < 0) break;
                readTotal += n;
            }

            requestCount.incrementAndGet();

            String responseBody = "{\"saved\":0,\"duplicates\":0}";
            byte[] bodyBytes = responseBody.getBytes(StandardCharsets.UTF_8);
            String statusText = responseStatus == 200 ? "OK" : (responseStatus == 401 ? "Unauthorized" : "Error");
            String headers = "HTTP/1.1 " + responseStatus + " " + statusText + "\r\n"
                + "Content-Type: application/json\r\n"
                + "Content-Length: " + bodyBytes.length + "\r\n"
                + "Connection: close\r\n"
                + "\r\n";

            OutputStream os = s.getOutputStream();
            os.write(headers.getBytes(StandardCharsets.UTF_8));
            os.write(bodyBytes);
            os.flush();
        } catch (IOException ignored) {
            // Connexion fermée côté client ou erreur de lecture — sans impact sur le test
            // (le client HttpURLConnection gère lui-même son propre timeout/erreur).
        }
    }

    void stop() {
        running = false;
        try {
            serverSocket.close();
        } catch (IOException ignored) {
        }
    }
}
