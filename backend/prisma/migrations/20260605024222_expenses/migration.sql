-- CreateTable
CREATE TABLE `expenses` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `date` VARCHAR(191) NOT NULL,
    `concept` VARCHAR(191) NOT NULL,
    `category` VARCHAR(191) NULL,
    `amount` INTEGER NOT NULL,
    `boxCode` VARCHAR(191) NOT NULL DEFAULT 'CAJA_MENOR',
    `note` VARCHAR(191) NULL,
    `createdBy` VARCHAR(191) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'activa',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `expenses_date_idx`(`date`),
    INDEX `expenses_boxCode_idx`(`boxCode`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
