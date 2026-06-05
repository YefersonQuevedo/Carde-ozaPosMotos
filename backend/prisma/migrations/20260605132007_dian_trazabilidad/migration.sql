-- AlterTable
ALTER TABLE `invoices` ADD COLUMN `authorization` VARCHAR(191) NULL,
    ADD COLUMN `dianIsValid` BOOLEAN NULL,
    ADD COLUMN `dianMessages` TEXT NULL,
    ADD COLUMN `dianTrackId` VARCHAR(191) NULL,
    ADD COLUMN `environment` INTEGER NULL,
    ADD COLUMN `lastSentAt` DATETIME(3) NULL,
    ADD COLUMN `qrUrl` TEXT NULL,
    ADD COLUMN `retries` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `sendStatus` VARCHAR(191) NOT NULL DEFAULT 'PENDIENTE',
    ADD COLUMN `softwareId` VARCHAR(191) NULL,
    ADD COLUMN `sourceSystem` VARCHAR(191) NULL,
    ADD COLUMN `technicalKey` VARCHAR(191) NULL,
    ADD COLUMN `validatedAt` DATETIME(3) NULL,
    ADD COLUMN `xmlName` VARCHAR(191) NULL,
    ADD COLUMN `zipName` VARCHAR(191) NULL,
    ADD COLUMN `zipPath` TEXT NULL;

-- CreateTable
CREATE TABLE `dian_config` (
    `id` INTEGER NOT NULL DEFAULT 1,
    `companyNit` VARCHAR(191) NULL,
    `companyDv` VARCHAR(191) NULL,
    `companyName` VARCHAR(191) NULL,
    `apidianUrl` VARCHAR(191) NULL,
    `apidianToken` VARCHAR(191) NULL,
    `testSetId` VARCHAR(191) NULL,
    `softwareId` VARCHAR(191) NULL,
    `softwarePin` VARCHAR(191) NULL,
    `environment` INTEGER NOT NULL DEFAULT 2,
    `resolution` VARCHAR(191) NULL,
    `prefix` VARCHAR(191) NULL,
    `emailApiUrl` VARCHAR(191) NULL,
    `active` BOOLEAN NOT NULL DEFAULT false,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `invoices_sendStatus_idx` ON `invoices`(`sendStatus`);
