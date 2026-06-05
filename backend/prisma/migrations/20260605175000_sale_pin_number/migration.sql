-- PIN SuperFlex/RUNT de 19 digitos asociado a la RTM realizada.
ALTER TABLE `sales` ADD COLUMN `pinNumber` VARCHAR(191) NULL;
CREATE INDEX `sales_pinNumber_idx` ON `sales`(`pinNumber`);
