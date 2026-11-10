FROM node:24-bookworm-slim AS frontend
WORKDIR /src
COPY frontend/package*.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

FROM maven:3.9-eclipse-temurin-21 AS backend
WORKDIR /src
COPY backend/pom.xml ./
RUN mvn -B dependency:go-offline
COPY backend/src ./src
COPY --from=frontend /src/dist ./src/main/resources/static
RUN mvn -B package

FROM eclipse-temurin:21-jre
WORKDIR /app
COPY --from=backend /src/target/campus-0.1.0.jar campus.jar
USER 10001
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "/app/campus.jar"]
