-- CreateTable
CREATE TABLE `notification_config` (
    `id` INTEGER NOT NULL DEFAULT 1,
    `emailEnabled` BOOLEAN NOT NULL DEFAULT false,
    `emailApiUrl` VARCHAR(191) NULL,
    `emailFrom` VARCHAR(191) NULL,
    `telegramEnabled` BOOLEAN NOT NULL DEFAULT false,
    `telegramBotToken` VARCHAR(191) NULL,
    `telegramChatId` VARCHAR(191) NULL,
    `whatsappEnabled` BOOLEAN NOT NULL DEFAULT false,
    `whatsappApiUrl` VARCHAR(191) NULL,
    `whatsappToken` VARCHAR(191) NULL,
    `whatsappPhoneId` VARCHAR(191) NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
