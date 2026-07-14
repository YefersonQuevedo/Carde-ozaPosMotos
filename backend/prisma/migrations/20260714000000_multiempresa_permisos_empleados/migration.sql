-- Multi-empresa, permisos por rol y nomina.
--
-- Estos cambios se habian aplicado con 'prisma db push', que no deja
-- migracion. Resultado: una base creada desde cero con 'migrate deploy'
-- no tenia companyId ni las tablas companies/role_permissions/employees,
-- y el codigo no podia funcionar contra ella. Esta migracion recupera ese
-- desfase para que una instalacion nueva quede igual que el schema.
--
-- Generada con 'prisma migrate diff' contra el schema del 2026-07-14.

-- DropIndex
DROP INDEX `cash_boxes_code_key` ON `cash_boxes`;

-- DropIndex
DROP INDEX `clients_docNumber_key` ON `clients`;

-- DropIndex
DROP INDEX `daily_closings_closingDate_key` ON `daily_closings`;

-- DropIndex
DROP INDEX `expense_natures_code_key` ON `expense_natures`;

-- DropIndex
DROP INDEX `invoices_number_key` ON `invoices`;

-- DropIndex
DROP INDEX `manual_invoices_number_key` ON `manual_invoices`;

-- DropIndex
DROP INDEX `packages_code_key` ON `packages`;

-- DropIndex
DROP INDEX `payment_methods_code_key` ON `payment_methods`;

-- DropIndex
DROP INDEX `products_code_key` ON `products`;

-- DropIndex
DROP INDEX `purchase_orders_number_key` ON `purchase_orders`;

-- DropIndex
DROP INDEX `sales_saleNumber_key` ON `sales`;

-- DropIndex
DROP INDEX `shifts_number_key` ON `shifts`;

-- DropIndex
DROP INDEX `suppliers_docNumber_key` ON `suppliers`;

-- AlterTable
ALTER TABLE `allies` ADD COLUMN `companyId` INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE `ally_payments` ADD COLUMN `companyId` INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN `createdBy` VARCHAR(191) NULL,
    ADD COLUMN `editedAt` DATETIME(3) NULL,
    ADD COLUMN `status` VARCHAR(191) NOT NULL DEFAULT 'activa',
    ADD COLUMN `updatedBy` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `call_logs` ADD COLUMN `companyId` INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE `cash_boxes` ADD COLUMN `companyId` INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE `cash_movements` ADD COLUMN `companyId` INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE `client_history` ADD COLUMN `companyId` INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE `clients` ADD COLUMN `companyId` INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE `daily_closings` ADD COLUMN `companyId` INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE `dian_config` ADD COLUMN `companyId` INTEGER NOT NULL DEFAULT 1,
    MODIFY `id` INTEGER NOT NULL AUTO_INCREMENT;

-- AlterTable
ALTER TABLE `expense_natures` ADD COLUMN `companyId` INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE `expenses` ADD COLUMN `companyId` INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN `updatedBy` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `fupa_movements` ADD COLUMN `companyId` INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE `incomes` ADD COLUMN `companyId` INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN `updatedBy` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `invoices` ADD COLUMN `companyId` INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE `manual_invoice_lines` ADD COLUMN `companyId` INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE `manual_invoices` ADD COLUMN `companyId` INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE `notification_config` ADD COLUMN `companyId` INTEGER NOT NULL DEFAULT 1,
    MODIFY `id` INTEGER NOT NULL AUTO_INCREMENT;

-- AlterTable
ALTER TABLE `package_components` ADD COLUMN `companyId` INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE `packages` ADD COLUMN `companyId` INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE `payable_payments` ADD COLUMN `companyId` INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE `payables` ADD COLUMN `companyId` INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE `payment_methods` ADD COLUMN `companyId` INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE `products` ADD COLUMN `companyId` INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE `purchase_order_lines` ADD COLUMN `companyId` INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE `purchase_orders` ADD COLUMN `companyId` INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE `receivable_payments` ADD COLUMN `companyId` INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN `createdBy` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `receivables` ADD COLUMN `companyId` INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE `reversals` ADD COLUMN `companyId` INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE `sale_costs` ADD COLUMN `companyId` INTEGER NOT NULL DEFAULT 1,
    MODIFY `sicov` DOUBLE NOT NULL DEFAULT 0,
    MODIFY `ivaSicov` DOUBLE NOT NULL DEFAULT 0,
    MODIFY `recaudo` DOUBLE NOT NULL DEFAULT 0,
    MODIFY `ivaRecaudo` DOUBLE NOT NULL DEFAULT 0,
    MODIFY `ansv` DOUBLE NOT NULL DEFAULT 0,
    MODIFY `fupa` DOUBLE NOT NULL DEFAULT 0,
    MODIFY `sustratos` DOUBLE NOT NULL DEFAULT 0,
    MODIFY `ivaFact` DOUBLE NOT NULL DEFAULT 0,
    MODIFY `costeTransaccion` DOUBLE NOT NULL DEFAULT 0,
    MODIFY `costosTotal` DOUBLE NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE `sale_lines` ADD COLUMN `companyId` INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE `sale_payments` ADD COLUMN `companyId` INTEGER NOT NULL DEFAULT 1,
    MODIFY `costAmount` DOUBLE NOT NULL DEFAULT 0,
    MODIFY `costTax` DOUBLE NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE `sales` ADD COLUMN `companyId` INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN `createdBy` VARCHAR(191) NULL,
    ADD COLUMN `updatedBy` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `shifts` ADD COLUMN `companyId` INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE `supplier_invoice_payments` ADD COLUMN `companyId` INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE `supplier_invoices` ADD COLUMN `companyId` INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE `suppliers` ADD COLUMN `companyId` INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE `tariffs` ADD COLUMN `companyId` INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE `users` ADD COLUMN `companyId` INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE `vehicles` ADD COLUMN `companyId` INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE `companies` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `nit` VARCHAR(191) NULL,
    `dv` VARCHAR(191) NULL,
    `name` VARCHAR(191) NOT NULL,
    `commercialName` VARCHAR(191) NULL,
    `address` VARCHAR(191) NULL,
    `city` VARCHAR(191) NULL,
    `phone` VARCHAR(191) NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `role_permissions` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `companyId` INTEGER NOT NULL DEFAULT 1,
    `role` VARCHAR(191) NOT NULL,
    `label` VARCHAR(191) NULL,
    `canWrite` BOOLEAN NOT NULL DEFAULT true,
    `canDelete` BOOLEAN NOT NULL DEFAULT true,
    `views` JSON NOT NULL,
    `exports` JSON NOT NULL,
    `updatedAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `role_permissions_companyId_role_key`(`companyId`, `role`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `employees` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `companyId` INTEGER NOT NULL DEFAULT 1,
    `name` VARCHAR(191) NOT NULL,
    `docNumber` VARCHAR(191) NULL,
    `role` VARCHAR(191) NULL,
    `salaryBase` INTEGER NOT NULL DEFAULT 0,
    `auxTransporte` INTEGER NOT NULL DEFAULT 0,
    `auxAlimentacion` INTEGER NOT NULL DEFAULT 0,
    `paymentMethod` VARCHAR(191) NOT NULL DEFAULT 'banco',
    `active` BOOLEAN NOT NULL DEFAULT true,
    `startDate` VARCHAR(191) NULL,
    `note` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `employees_companyId_idx`(`companyId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `allies_companyId_idx` ON `allies`(`companyId`);

-- CreateIndex
CREATE INDEX `cash_boxes_companyId_idx` ON `cash_boxes`(`companyId`);

-- CreateIndex
CREATE UNIQUE INDEX `cash_boxes_companyId_code_key` ON `cash_boxes`(`companyId`, `code`);

-- CreateIndex
CREATE INDEX `cash_movements_companyId_idx` ON `cash_movements`(`companyId`);

-- CreateIndex
CREATE INDEX `clients_companyId_idx` ON `clients`(`companyId`);

-- CreateIndex
CREATE UNIQUE INDEX `clients_companyId_docNumber_key` ON `clients`(`companyId`, `docNumber`);

-- CreateIndex
CREATE INDEX `daily_closings_companyId_idx` ON `daily_closings`(`companyId`);

-- CreateIndex
CREATE UNIQUE INDEX `daily_closings_companyId_closingDate_key` ON `daily_closings`(`companyId`, `closingDate`);

-- CreateIndex
CREATE UNIQUE INDEX `dian_config_companyId_key` ON `dian_config`(`companyId`);

-- CreateIndex
CREATE INDEX `expense_natures_companyId_idx` ON `expense_natures`(`companyId`);

-- CreateIndex
CREATE UNIQUE INDEX `expense_natures_companyId_code_key` ON `expense_natures`(`companyId`, `code`);

-- CreateIndex
CREATE INDEX `invoices_companyId_idx` ON `invoices`(`companyId`);

-- CreateIndex
CREATE UNIQUE INDEX `invoices_companyId_number_key` ON `invoices`(`companyId`, `number`);

-- CreateIndex
CREATE INDEX `manual_invoices_companyId_idx` ON `manual_invoices`(`companyId`);

-- CreateIndex
CREATE UNIQUE INDEX `manual_invoices_companyId_number_key` ON `manual_invoices`(`companyId`, `number`);

-- CreateIndex
CREATE UNIQUE INDEX `notification_config_companyId_key` ON `notification_config`(`companyId`);

-- CreateIndex
CREATE INDEX `package_components_companyId_idx` ON `package_components`(`companyId`);

-- CreateIndex
CREATE INDEX `packages_companyId_idx` ON `packages`(`companyId`);

-- CreateIndex
CREATE UNIQUE INDEX `packages_companyId_code_key` ON `packages`(`companyId`, `code`);

-- CreateIndex
CREATE INDEX `payment_methods_companyId_idx` ON `payment_methods`(`companyId`);

-- CreateIndex
CREATE UNIQUE INDEX `payment_methods_companyId_code_key` ON `payment_methods`(`companyId`, `code`);

-- CreateIndex
CREATE INDEX `products_companyId_idx` ON `products`(`companyId`);

-- CreateIndex
CREATE UNIQUE INDEX `products_companyId_code_key` ON `products`(`companyId`, `code`);

-- CreateIndex
CREATE INDEX `purchase_orders_companyId_idx` ON `purchase_orders`(`companyId`);

-- CreateIndex
CREATE UNIQUE INDEX `purchase_orders_companyId_number_key` ON `purchase_orders`(`companyId`, `number`);

-- CreateIndex
CREATE INDEX `sales_companyId_idx` ON `sales`(`companyId`);

-- CreateIndex
CREATE UNIQUE INDEX `sales_companyId_saleNumber_key` ON `sales`(`companyId`, `saleNumber`);

-- CreateIndex
CREATE INDEX `shifts_companyId_idx` ON `shifts`(`companyId`);

-- CreateIndex
CREATE UNIQUE INDEX `shifts_companyId_number_key` ON `shifts`(`companyId`, `number`);

-- CreateIndex
CREATE INDEX `suppliers_companyId_idx` ON `suppliers`(`companyId`);

-- CreateIndex
CREATE UNIQUE INDEX `suppliers_companyId_docNumber_key` ON `suppliers`(`companyId`, `docNumber`);

-- CreateIndex
CREATE INDEX `tariffs_companyId_idx` ON `tariffs`(`companyId`);

-- CreateIndex
CREATE INDEX `users_companyId_idx` ON `users`(`companyId`);

-- CreateIndex
CREATE INDEX `vehicles_companyId_idx` ON `vehicles`(`companyId`);

