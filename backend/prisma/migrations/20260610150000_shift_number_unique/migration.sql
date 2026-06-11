-- Numero de turno global unico
ALTER TABLE `shifts` ADD UNIQUE INDEX `shifts_number_key`(`number`);
