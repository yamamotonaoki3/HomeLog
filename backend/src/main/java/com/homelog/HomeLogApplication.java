package com.homelog;

import org.mybatis.spring.annotation.MapperScan;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication
@MapperScan("com.homelog")
public class HomeLogApplication {

    public static void main(String[] args) {
        SpringApplication.run(HomeLogApplication.class, args);
    }
}
