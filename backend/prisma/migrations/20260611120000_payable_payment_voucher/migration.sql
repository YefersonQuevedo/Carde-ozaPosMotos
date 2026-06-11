-- AlterTable
ALTER TABLE `payable_payments` ADD COLUMN `voucherPath` VARCHAR(191) NULL,
    ADD COLUMN `paidBy` VARCHAR(191) NULL;
