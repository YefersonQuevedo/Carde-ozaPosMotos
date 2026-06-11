-- AlterTable
ALTER TABLE `payables` ADD COLUMN `refId` INTEGER NULL,
    ADD COLUMN `refType` VARCHAR(191) NULL;

-- CreateIndex
CREATE INDEX `payables_creditor_idx` ON `payables`(`creditor`);

-- CreateIndex
CREATE INDEX `payables_refType_refId_idx` ON `payables`(`refType`, `refId`);
