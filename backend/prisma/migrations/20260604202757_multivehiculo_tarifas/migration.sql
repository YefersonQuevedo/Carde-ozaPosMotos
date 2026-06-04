-- AlterTable
ALTER TABLE `packages` ADD COLUMN `vehicleType` VARCHAR(191) NOT NULL DEFAULT 'MOTO';

-- AlterTable
ALTER TABLE `products` ADD COLUMN `vehicleType` VARCHAR(191) NOT NULL DEFAULT 'MOTO';

-- AlterTable
ALTER TABLE `sales` ADD COLUMN `vehicleType` VARCHAR(191) NOT NULL DEFAULT 'MOTO';

-- AlterTable
ALTER TABLE `vehicles` ADD COLUMN `vehicleType` VARCHAR(191) NOT NULL DEFAULT 'MOTO';

-- CreateTable
CREATE TABLE `tariffs` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `vehicleType` VARCHAR(191) NOT NULL DEFAULT 'MOTO',
    `concept` VARCHAR(191) NOT NULL,
    `value` INTEGER NOT NULL,
    `yearFrom` INTEGER NOT NULL DEFAULT 0,
    `yearTo` INTEGER NOT NULL DEFAULT 9999,
    `validFrom` VARCHAR(191) NOT NULL DEFAULT '2026-01-01',
    `active` BOOLEAN NOT NULL DEFAULT true,

    INDEX `tariffs_vehicleType_concept_idx`(`vehicleType`, `concept`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
