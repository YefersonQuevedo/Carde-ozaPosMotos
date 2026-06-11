-- AlterTable
ALTER TABLE `sales` ADD COLUMN `commissionPaidBy` INTEGER NULL;

-- AlterTable
ALTER TABLE `shifts` ALTER COLUMN `number` DROP DEFAULT;

-- CreateIndex
CREATE INDEX `sales_commissionPaidBy_idx` ON `sales`(`commissionPaidBy`);
