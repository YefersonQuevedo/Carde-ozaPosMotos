-- AlterTable
ALTER TABLE `sales` ADD COLUMN `shiftId` INTEGER NULL;

-- CreateTable
CREATE TABLE `shifts` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `businessDate` VARCHAR(191) NOT NULL,
    `number` INTEGER NOT NULL DEFAULT 1,
    `status` VARCHAR(191) NOT NULL DEFAULT 'abierto',
    `openingCash` INTEGER NOT NULL DEFAULT 0,
    `openedBy` VARCHAR(191) NULL,
    `openedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expectedCash` INTEGER NOT NULL DEFAULT 0,
    `countedCash` INTEGER NULL,
    `cashDiff` INTEGER NOT NULL DEFAULT 0,
    `salesTotal` INTEGER NOT NULL DEFAULT 0,
    `jasper` INTEGER NOT NULL DEFAULT 0,
    `provision` INTEGER NOT NULL DEFAULT 0,
    `closedBy` VARCHAR(191) NULL,
    `closedAt` DATETIME(3) NULL,
    `note` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `shifts_businessDate_idx`(`businessDate`),
    INDEX `shifts_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `sales_shiftId_idx` ON `sales`(`shiftId`);
