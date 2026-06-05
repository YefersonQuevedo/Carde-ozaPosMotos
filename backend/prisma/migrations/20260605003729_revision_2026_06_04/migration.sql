-- AlterTable
ALTER TABLE `ally_payments` ADD COLUMN `convenioCount` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `invoiceNumber` VARCHAR(191) NULL,
    ADD COLUMN `plates` JSON NULL,
    ADD COLUMN `voucherPath` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `clients` ADD COLUMN `phones` JSON NULL;

-- AlterTable
ALTER TABLE `receivables` ADD COLUMN `ica` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `invoiceNumber` VARCHAR(191) NULL,
    ADD COLUMN `paymentRef` VARCHAR(191) NULL,
    ADD COLUMN `retefuente` INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE `sales` ADD COLUMN `provisionConsumed` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `provisionSourcePlate` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `receivable_payments` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `receivableId` INTEGER NOT NULL,
    `provider` VARCHAR(191) NOT NULL,
    `invoiceNumber` VARCHAR(191) NULL,
    `amount` INTEGER NOT NULL,
    `ica` INTEGER NOT NULL DEFAULT 0,
    `retefuente` INTEGER NOT NULL DEFAULT 0,
    `paidDate` VARCHAR(191) NOT NULL,
    `note` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `receivable_payments_receivableId_idx`(`receivableId`),
    INDEX `receivable_payments_provider_idx`(`provider`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `client_history` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `clientDoc` VARCHAR(191) NOT NULL,
    `saleId` INTEGER NULL,
    `plate` VARCHAR(191) NULL,
    `year` INTEGER NOT NULL,
    `eventType` VARCHAR(191) NOT NULL,
    `allyId` INTEGER NULL,
    `allyName` VARCHAR(191) NULL,
    `note` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `client_history_clientDoc_idx`(`clientDoc`),
    INDEX `client_history_year_idx`(`year`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `cash_boxes` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `code` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `kind` VARCHAR(191) NOT NULL DEFAULT 'otra',
    `active` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `cash_boxes_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `cash_movements` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `boxCode` VARCHAR(191) NOT NULL,
    `type` VARCHAR(191) NOT NULL,
    `amount` INTEGER NOT NULL,
    `refType` VARCHAR(191) NULL,
    `refId` INTEGER NULL,
    `date` VARCHAR(191) NOT NULL,
    `note` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `cash_movements_boxCode_idx`(`boxCode`),
    INDEX `cash_movements_date_idx`(`date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `suppliers` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `docType` VARCHAR(191) NOT NULL DEFAULT 'NIT',
    `docNumber` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NULL,
    `phone` VARCHAR(191) NULL,
    `address` VARCHAR(191) NULL,
    `paymentMethod` VARCHAR(191) NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `suppliers_docNumber_key`(`docNumber`),
    INDEX `suppliers_name_idx`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `purchase_orders` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `number` VARCHAR(191) NOT NULL,
    `supplierId` INTEGER NULL,
    `supplierName` VARCHAR(191) NOT NULL,
    `date` VARCHAR(191) NOT NULL,
    `concept` VARCHAR(191) NULL,
    `base` INTEGER NOT NULL DEFAULT 0,
    `iva` INTEGER NOT NULL DEFAULT 0,
    `total` INTEGER NOT NULL DEFAULT 0,
    `status` VARCHAR(191) NOT NULL DEFAULT 'emitida',
    `note` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `purchase_orders_number_key`(`number`),
    INDEX `purchase_orders_supplierId_idx`(`supplierId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `purchase_order_lines` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `orderId` INTEGER NOT NULL,
    `description` VARCHAR(191) NOT NULL,
    `quantity` INTEGER NOT NULL DEFAULT 1,
    `unitPrice` INTEGER NOT NULL DEFAULT 0,
    `taxRate` INTEGER NOT NULL DEFAULT 0,
    `base` INTEGER NOT NULL DEFAULT 0,
    `tax` INTEGER NOT NULL DEFAULT 0,
    `total` INTEGER NOT NULL DEFAULT 0,

    INDEX `purchase_order_lines_orderId_idx`(`orderId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `manual_invoices` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `number` VARCHAR(191) NOT NULL,
    `clientDoc` VARCHAR(191) NOT NULL,
    `clientName` VARCHAR(191) NOT NULL,
    `date` VARCHAR(191) NOT NULL,
    `concept` VARCHAR(191) NULL,
    `base` INTEGER NOT NULL DEFAULT 0,
    `iva` INTEGER NOT NULL DEFAULT 0,
    `total` INTEGER NOT NULL DEFAULT 0,
    `cufe` VARCHAR(191) NULL,
    `dianStatus` VARCHAR(191) NOT NULL DEFAULT 'emitida_local',
    `source` VARCHAR(191) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'activa',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `manual_invoices_number_key`(`number`),
    INDEX `manual_invoices_clientDoc_idx`(`clientDoc`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `manual_invoice_lines` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `invoiceId` INTEGER NOT NULL,
    `description` VARCHAR(191) NOT NULL,
    `quantity` INTEGER NOT NULL DEFAULT 1,
    `unitPrice` INTEGER NOT NULL DEFAULT 0,
    `taxRate` INTEGER NOT NULL DEFAULT 0,
    `base` INTEGER NOT NULL DEFAULT 0,
    `tax` INTEGER NOT NULL DEFAULT 0,
    `total` INTEGER NOT NULL DEFAULT 0,

    INDEX `manual_invoice_lines_invoiceId_idx`(`invoiceId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `receivables_invoiceNumber_idx` ON `receivables`(`invoiceNumber`);
