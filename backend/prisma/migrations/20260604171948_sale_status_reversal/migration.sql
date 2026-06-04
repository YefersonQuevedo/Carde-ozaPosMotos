-- AlterTable
ALTER TABLE `sales` ADD COLUMN `status` VARCHAR(191) NOT NULL DEFAULT 'activa';

-- CreateTable
CREATE TABLE `reversals` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `saleId` INTEGER NOT NULL,
    `saleNumber` VARCHAR(191) NOT NULL,
    `reason` VARCHAR(191) NULL,
    `authorizedBy` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `reversals_saleId_idx`(`saleId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
