-- CreateTable
CREATE TABLE `call_logs` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `clientDoc` VARCHAR(191) NULL,
    `clientName` VARCHAR(191) NULL,
    `plate` VARCHAR(191) NULL,
    `phone` VARCHAR(191) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'pendiente',
    `result` VARCHAR(191) NULL,
    `note` TEXT NULL,
    `dueDate` VARCHAR(191) NULL,
    `nextCallDate` VARCHAR(191) NULL,
    `createdBy` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `call_logs_clientDoc_idx`(`clientDoc`),
    INDEX `call_logs_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `payables` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `concept` VARCHAR(191) NOT NULL,
    `creditor` VARCHAR(191) NULL,
    `category` VARCHAR(191) NULL,
    `totalAmount` INTEGER NOT NULL DEFAULT 0,
    `paidAmount` INTEGER NOT NULL DEFAULT 0,
    `frequency` VARCHAR(191) NOT NULL DEFAULT 'unico',
    `installments` INTEGER NOT NULL DEFAULT 1,
    `installmentAmount` INTEGER NOT NULL DEFAULT 0,
    `dueDate` VARCHAR(191) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'pendiente',
    `note` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `payables_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `payable_payments` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `payableId` INTEGER NOT NULL,
    `amount` INTEGER NOT NULL,
    `paidDate` VARCHAR(191) NOT NULL,
    `note` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `payable_payments_payableId_idx`(`payableId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
