-- CreateTable
CREATE TABLE `incomes` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `date` VARCHAR(191) NOT NULL,
    `value` INTEGER NOT NULL,
    `observation` VARCHAR(191) NULL,
    `natureCode` VARCHAR(191) NULL,
    `source` VARCHAR(191) NOT NULL DEFAULT 'efectivo',
    `boxCode` VARCHAR(191) NULL,
    `note` VARCHAR(191) NULL,
    `createdBy` VARCHAR(191) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'activa',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `incomes_date_idx`(`date`),
    INDEX `incomes_natureCode_idx`(`natureCode`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
