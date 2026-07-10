package com.homelog.common.util;

import java.security.SecureRandom;

/**
 * 世帯グループの招待コード（英数字16文字）を生成する（F02_household.md参照）。
 */
public final class InviteCodeGenerator {

    private static final String CHARACTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    private static final int LENGTH = 16;
    private static final SecureRandom RANDOM = new SecureRandom();

    private InviteCodeGenerator() {
    }

    public static String generate() {
        StringBuilder builder = new StringBuilder(LENGTH);
        for (int i = 0; i < LENGTH; i++) {
            builder.append(CHARACTERS.charAt(RANDOM.nextInt(CHARACTERS.length())));
        }
        return builder.toString();
    }
}
