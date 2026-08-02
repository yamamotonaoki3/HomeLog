package com.homelog;

import org.mybatis.spring.annotation.MapperScan;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableScheduling;

@SpringBootApplication
@MapperScan("com.homelog")
@EnableScheduling
public class HomeLogApplication {

    public static void main(String[] args) {
        SpringApplication.run(HomeLogApplication.class, args);
    }
}
