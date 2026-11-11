package ru.bstu.campus;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties("campus.llm")
record LlmProperties(String provider, String url, String baseUrl, String model, String apiKey, String reasoningEffort,
                     boolean jsonMode, String tokenField) {}
