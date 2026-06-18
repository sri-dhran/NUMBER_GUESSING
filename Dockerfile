FROM eclipse-temurin:21-jdk-alpine

WORKDIR /app

# Copy the Java source code
COPY NUMBR.java .

# Compile the Java application
RUN javac NUMBR.java

# Expose the port (Render sets the PORT environment variable)
EXPOSE 8080

# Run the Java application
CMD ["java", "NUMBR"]
