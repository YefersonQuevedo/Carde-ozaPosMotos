-- Historial de pagos de facturas recibidas. Sin FKs, consistente con el resto del repo.
CREATE TABLE `supplier_invoice_payments` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `invoiceId` INTEGER NOT NULL,
    `amount` INTEGER NOT NULL,
    `paidDate` VARCHAR(191) NOT NULL,
    `boxCode` VARCHAR(191) NOT NULL DEFAULT 'CAJA_MENOR',
    `note` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `supplier_invoice_payments_invoiceId_idx`(`invoiceId`),
    INDEX `supplier_invoice_payments_boxCode_idx`(`boxCode`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
