-- CreateTable
CREATE TABLE `ally_payments` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `allyId` INTEGER NULL,
    `allyName` VARCHAR(191) NOT NULL,
    `amount` INTEGER NOT NULL,
    `paidDate` VARCHAR(191) NOT NULL,
    `note` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ally_payments_allyName_idx`(`allyName`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
