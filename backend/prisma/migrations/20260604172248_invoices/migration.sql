-- CreateTable
CREATE TABLE `invoices` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `saleId` INTEGER NOT NULL,
    `number` VARCHAR(191) NOT NULL,
    `cufe` VARCHAR(191) NULL,
    `dianStatus` VARCHAR(191) NOT NULL DEFAULT 'emitida_local',
    `base` INTEGER NOT NULL DEFAULT 0,
    `iva` INTEGER NOT NULL DEFAULT 0,
    `total` INTEGER NOT NULL DEFAULT 0,
    `issuedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `invoices_saleId_key`(`saleId`),
    UNIQUE INDEX `invoices_number_key`(`number`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
