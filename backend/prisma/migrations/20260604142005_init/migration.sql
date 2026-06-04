-- CreateTable
CREATE TABLE `clients` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `docType` VARCHAR(191) NOT NULL DEFAULT 'CC',
    `docNumber` VARCHAR(191) NOT NULL,
    `dv` VARCHAR(191) NULL,
    `personType` VARCHAR(191) NOT NULL DEFAULT 'NATURAL',
    `name` VARCHAR(191) NOT NULL,
    `commercialName` VARCHAR(191) NULL,
    `email` VARCHAR(191) NULL,
    `phone` VARCHAR(191) NULL,
    `address` VARCHAR(191) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'ACTIVO',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `clients_docNumber_key`(`docNumber`),
    INDEX `clients_name_idx`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `vehicles` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `clientDoc` VARCHAR(191) NOT NULL,
    `plate` VARCHAR(191) NOT NULL,
    `modelYear` INTEGER NULL,
    `rangeName` VARCHAR(191) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'ACTIVO',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `vehicles_clientDoc_idx`(`clientDoc`),
    INDEX `vehicles_plate_idx`(`plate`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `allies` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `contactPhone` VARCHAR(191) NULL,
    `altPhone` VARCHAR(191) NULL,
    `docType` VARCHAR(191) NULL,
    `docNumber` VARCHAR(191) NULL,
    `paymentMethod` VARCHAR(191) NULL,
    `accountNumber` VARCHAR(191) NULL,
    `holderDocType` VARCHAR(191) NULL,
    `holderDoc` VARCHAR(191) NULL,
    `address` VARCHAR(191) NULL,
    `company` VARCHAR(191) NULL,
    `observation` TEXT NULL,
    `notes` TEXT NULL,
    `enrolled` BOOLEAN NOT NULL DEFAULT false,
    `commission` INTEGER NOT NULL DEFAULT 40000,
    `isDirectUser` BOOLEAN NOT NULL DEFAULT false,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `allies_name_idx`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `products` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `code` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `unitPrice` INTEGER NOT NULL,
    `taxRate` INTEGER NOT NULL DEFAULT 0,
    `active` BOOLEAN NOT NULL DEFAULT true,

    UNIQUE INDEX `products_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `packages` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `code` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `rangeName` VARCHAR(191) NOT NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,

    UNIQUE INDEX `packages_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `package_components` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `packageCode` VARCHAR(191) NOT NULL,
    `productCode` VARCHAR(191) NOT NULL,
    `quantity` INTEGER NOT NULL DEFAULT 1,
    `priceOverride` INTEGER NULL,

    INDEX `package_components_packageCode_idx`(`packageCode`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `payment_methods` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `code` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `groupCode` VARCHAR(191) NOT NULL,
    `isCredit` BOOLEAN NOT NULL DEFAULT false,
    `generatesReceivable` BOOLEAN NOT NULL DEFAULT false,
    `facturaDian` BOOLEAN NOT NULL DEFAULT false,
    `costType` VARCHAR(191) NOT NULL DEFAULT 'none',
    `costRate` DOUBLE NOT NULL DEFAULT 0,
    `costAmount` INTEGER NOT NULL DEFAULT 0,
    `costTaxRate` DOUBLE NOT NULL DEFAULT 0,
    `active` BOOLEAN NOT NULL DEFAULT true,

    UNIQUE INDEX `payment_methods_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sales` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `saleNumber` VARCHAR(191) NOT NULL,
    `saleDate` VARCHAR(191) NOT NULL,
    `saleTime` VARCHAR(191) NULL,
    `clientDoc` VARCHAR(191) NOT NULL,
    `clientName` VARCHAR(191) NOT NULL,
    `plate` VARCHAR(191) NULL,
    `modelYear` INTEGER NULL,
    `rangeName` VARCHAR(191) NULL,
    `packageCode` VARCHAR(191) NULL,
    `allyName` VARCHAR(191) NULL,
    `allyType` VARCHAR(191) NOT NULL DEFAULT 'usuario',
    `discountApplied` BOOLEAN NOT NULL DEFAULT true,
    `deduction` INTEGER NOT NULL DEFAULT 0,
    `totalBase` INTEGER NOT NULL DEFAULT 0,
    `totalIva` INTEGER NOT NULL DEFAULT 0,
    `total` INTEGER NOT NULL DEFAULT 0,
    `paidAmount` INTEGER NOT NULL DEFAULT 0,
    `changeAmount` INTEGER NOT NULL DEFAULT 0,
    `rtmAlreadyPaid` BOOLEAN NOT NULL DEFAULT false,
    `rtmToday` BOOLEAN NOT NULL DEFAULT true,
    `rtmStatus` VARCHAR(191) NOT NULL DEFAULT 'done',
    `pinAdquirido` INTEGER NOT NULL DEFAULT 0,
    `provisionAmount` INTEGER NOT NULL DEFAULT 0,
    `receivableAmount` INTEGER NOT NULL DEFAULT 0,
    `dianStatus` VARCHAR(191) NOT NULL DEFAULT 'no_emitida',
    `invoiceNumber` VARCHAR(191) NULL,
    `cufe` VARCHAR(191) NULL,
    `responsable` VARCHAR(191) NULL,
    `observaciones` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `sales_saleNumber_key`(`saleNumber`),
    INDEX `sales_saleDate_idx`(`saleDate`),
    INDEX `sales_clientDoc_idx`(`clientDoc`),
    INDEX `sales_plate_idx`(`plate`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sale_lines` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `saleId` INTEGER NOT NULL,
    `productCode` VARCHAR(191) NOT NULL,
    `description` VARCHAR(191) NOT NULL,
    `quantity` INTEGER NOT NULL DEFAULT 1,
    `unitPrice` INTEGER NOT NULL,
    `taxRate` INTEGER NOT NULL DEFAULT 0,
    `base` INTEGER NOT NULL DEFAULT 0,
    `tax` INTEGER NOT NULL DEFAULT 0,
    `total` INTEGER NOT NULL DEFAULT 0,

    INDEX `sale_lines_saleId_idx`(`saleId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sale_payments` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `saleId` INTEGER NOT NULL,
    `methodCode` VARCHAR(191) NOT NULL,
    `methodName` VARCHAR(191) NOT NULL,
    `groupCode` VARCHAR(191) NOT NULL,
    `amount` INTEGER NOT NULL,
    `costType` VARCHAR(191) NOT NULL DEFAULT 'none',
    `costAmount` INTEGER NOT NULL DEFAULT 0,
    `costTax` INTEGER NOT NULL DEFAULT 0,

    INDEX `sale_payments_saleId_idx`(`saleId`),
    INDEX `sale_payments_methodCode_idx`(`methodCode`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sale_costs` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `saleId` INTEGER NOT NULL,
    `sicov` INTEGER NOT NULL DEFAULT 0,
    `ivaSicov` INTEGER NOT NULL DEFAULT 0,
    `recaudo` INTEGER NOT NULL DEFAULT 0,
    `ivaRecaudo` INTEGER NOT NULL DEFAULT 0,
    `ansv` INTEGER NOT NULL DEFAULT 0,
    `fupa` INTEGER NOT NULL DEFAULT 0,
    `sustratos` INTEGER NOT NULL DEFAULT 0,
    `ivaFact` INTEGER NOT NULL DEFAULT 0,
    `costeTransaccion` INTEGER NOT NULL DEFAULT 0,
    `costosTotal` INTEGER NOT NULL DEFAULT 0,

    UNIQUE INDEX `sale_costs_saleId_key`(`saleId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `receivables` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `saleId` INTEGER NOT NULL,
    `provider` VARCHAR(191) NOT NULL,
    `clientDoc` VARCHAR(191) NOT NULL,
    `plate` VARCHAR(191) NULL,
    `amount` INTEGER NOT NULL,
    `pending` INTEGER NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'abierta',
    `dueFrom` VARCHAR(191) NOT NULL,
    `paidAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `receivables_provider_idx`(`provider`),
    INDEX `receivables_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `daily_closings` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `closingDate` VARCHAR(191) NOT NULL,
    `salesTotal` INTEGER NOT NULL DEFAULT 0,
    `byMethod` JSON NOT NULL,
    `provision` INTEGER NOT NULL DEFAULT 0,
    `receivableOpen` INTEGER NOT NULL DEFAULT 0,
    `jasperEstimado` INTEGER NOT NULL DEFAULT 0,
    `deducciones` INTEGER NOT NULL DEFAULT 0,
    `cajaEfectivo` INTEGER NOT NULL DEFAULT 0,
    `responsable` VARCHAR(191) NULL,
    `recibe` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `daily_closings_closingDate_key`(`closingDate`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
