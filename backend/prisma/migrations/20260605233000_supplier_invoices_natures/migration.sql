-- Catalogo normalizado de naturalezas de ingreso/gasto.
CREATE TABLE `expense_natures` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `code` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `kind` VARCHAR(191) NOT NULL DEFAULT 'gasto',
    `taxRelevant` BOOLEAN NOT NULL DEFAULT false,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `expense_natures_code_key`(`code`),
    INDEX `expense_natures_kind_idx`(`kind`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Facturas recibidas de proveedores. No usa FKs por el estilo del repo.
CREATE TABLE `supplier_invoices` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `supplierId` INTEGER NULL,
    `supplierDoc` VARCHAR(191) NULL,
    `supplierName` VARCHAR(191) NOT NULL,
    `number` VARCHAR(191) NOT NULL,
    `date` VARCHAR(191) NOT NULL,
    `dueDate` VARCHAR(191) NULL,
    `concept` VARCHAR(191) NULL,
    `natureCode` VARCHAR(191) NULL,
    `base` INTEGER NOT NULL DEFAULT 0,
    `iva` INTEGER NOT NULL DEFAULT 0,
    `total` INTEGER NOT NULL DEFAULT 0,
    `deductible` BOOLEAN NOT NULL DEFAULT true,
    `source` VARCHAR(191) NULL,
    `filePath` VARCHAR(191) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'pendiente',
    `paidAmount` INTEGER NOT NULL DEFAULT 0,
    `paidDate` VARCHAR(191) NULL,
    `note` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `supplier_invoices_supplierId_idx`(`supplierId`),
    INDEX `supplier_invoices_supplierDoc_idx`(`supplierDoc`),
    INDEX `supplier_invoices_date_idx`(`date`),
    INDEX `supplier_invoices_status_idx`(`status`),
    INDEX `supplier_invoices_natureCode_idx`(`natureCode`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE INDEX `expenses_category_idx` ON `expenses`(`category`);

INSERT INTO `expense_natures` (`code`, `name`, `kind`, `taxRelevant`) VALUES
('ARRIENDO', 'Arriendo', 'gasto', false),
('NOMINA', 'Nomina', 'gasto', false),
('CESANTIAS', 'Cesantias', 'gasto', false),
('RETENCION', 'Retencion', 'gasto', true),
('PARAFISCALES', 'Parafiscales', 'gasto', false),
('CREDITO', 'Credito', 'gasto', false),
('DISPERSION_ADDI', 'Dispersion ADDI', 'gasto', true),
('SOCIOS', 'Socios', 'gasto', false),
('SOAT', 'SOAT', 'gasto', true),
('CUATRO_POR_MIL', '4x1000', 'gasto', false),
('CUOTA_TARJETA', 'Cuota tarjeta', 'gasto', false),
('PROVEEDORES', 'Proveedores', 'gasto', true),
('VENTAS_RTM', 'Ventas RTM', 'ingreso', true),
('OTROS', 'Otros', 'ambos', false);
