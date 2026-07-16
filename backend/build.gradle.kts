plugins {
    java
    id("org.springframework.boot") version "4.0.3"
    id("io.spring.dependency-management") version "1.1.7"
    checkstyle
}

group = "com.homelog"
version = "0.0.1-SNAPSHOT"

java {
    toolchain {
        languageVersion = JavaLanguageVersion.of(25)
    }
}

repositories {
    mavenCentral()
}

dependencies {
    implementation(platform("software.amazon.awssdk:bom:2.28.0"))
    implementation("software.amazon.awssdk:s3")
    implementation("org.springframework.boot:spring-boot-starter-web")
    implementation("org.springframework.boot:spring-boot-starter-security")
    implementation("org.springframework.boot:spring-boot-starter-validation")
    implementation("org.mybatis:mybatis:3.5.19")
    implementation("org.mybatis:mybatis-spring:4.0.0")
    implementation("org.springframework.boot:spring-boot-starter-jdbc")
    implementation("io.jsonwebtoken:jjwt-api:0.12.6")
    runtimeOnly("io.jsonwebtoken:jjwt-impl:0.12.6")
    runtimeOnly("io.jsonwebtoken:jjwt-jackson:0.12.6")
    implementation("org.springframework.boot:spring-boot-flyway")
    implementation("org.flywaydb:flyway-core")
    implementation("org.flywaydb:flyway-database-postgresql")
    runtimeOnly("org.postgresql:postgresql")
    testImplementation("org.springframework.boot:spring-boot-starter-test")
    testImplementation("org.springframework.boot:spring-boot-webmvc-test")
    testImplementation("org.springframework.security:spring-security-test")
    // Spring Boot 4ではTestRestTemplateがspring-boot-resttestclientモジュールに分離されている
    // （spring-boot-restclientはTestRestTemplateが内部で使うRestTemplateBuilderを提供する）
    testImplementation("org.springframework.boot:spring-boot-resttestclient")
    testImplementation("org.springframework.boot:spring-boot-restclient")
    testImplementation(platform("org.testcontainers:testcontainers-bom:1.21.3"))
    testImplementation("org.springframework.boot:spring-boot-testcontainers")
    testImplementation("org.testcontainers:postgresql")
    testImplementation("org.testcontainers:junit-jupiter")
    // TestRestTemplateでPATCHメソッドを使うため（結合テスト）
    testImplementation("org.apache.httpcomponents.client5:httpclient5")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
    testRuntimeOnly("com.h2database:h2")
    implementation("org.springdoc:springdoc-openapi-starter-webmvc-ui:2.8.4")
    implementation("net.logstash.logback:logstash-logback-encoder:8.0")
}

checkstyle {
    toolVersion = "10.21.4"
    configFile = file("config/checkstyle/checkstyle.xml")
    isIgnoreFailures = false
}

// 単体テスト：integrationタグを除外し、Docker不要・高速なまま維持する
tasks.test {
    useJUnitPlatform {
        excludeTags("integration")
    }
}

// 結合テスト：Testcontainers（PostgreSQL 17）でController→Service→Mapper→DBを通しで検証する。
// Docker Desktopの起動が前提。実行: .\gradlew.bat integrationTest
tasks.register<Test>("integrationTest") {
    description = "Runs integration tests (requires Docker)."
    group = "verification"
    testClassesDirs = sourceSets["test"].output.classesDirs
    classpath = sourceSets["test"].runtimeClasspath
    useJUnitPlatform {
        includeTags("integration")
    }
    shouldRunAfter(tasks.test)
}
