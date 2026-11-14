-- Migration: add_guarantor_nok_collateral
-- Adds:
--   • Customer: maritalStatus, nokEnc, aboutUsChannel
--   • LoanApplication: selfReportedIncomeKobo, selfReportedOutstandingKobo, collateralStockDesc, collateralPropertyDesc
--   • Guarantor model (new table)

-- Customer: add marital status, encrypted NOK block, about-us channel
ALTER TABLE `Customer`
  ADD COLUMN `maritalStatus`   VARCHAR(20)   NULL,
  ADD COLUMN `nokEnc`          LONGTEXT      NULL,
  ADD COLUMN `aboutUsChannel`  VARCHAR(50)   NULL;

-- LoanApplication: add self-reported financial info and collateral descriptions
ALTER TABLE `LoanApplication`
  ADD COLUMN `selfReportedIncomeKobo`      BIGINT  NULL,
  ADD COLUMN `selfReportedOutstandingKobo` BIGINT  NULL,
  ADD COLUMN `collateralStockDesc`         LONGTEXT NULL,
  ADD COLUMN `collateralPropertyDesc`      LONGTEXT NULL;

-- Guarantor: new table
CREATE TABLE `Guarantor` (
  `id`            VARCHAR(191)  NOT NULL,
  `applicationId` VARCHAR(191)  NOT NULL,
  `firstName`     VARCHAR(191)  NOT NULL,
  `lastName`      VARCHAR(191)  NOT NULL,
  `phoneEnc`      LONGTEXT      NOT NULL,
  `phoneHash`     VARCHAR(191)  NOT NULL,
  `relationship`  VARCHAR(191)  NOT NULL,
  `occupation`    VARCHAR(191)  NULL,
  `dobEnc`        LONGTEXT      NULL,
  `bvnEnc`        LONGTEXT      NULL,
  `addressEnc`    LONGTEXT      NOT NULL,
  `idType`        VARCHAR(191)  NULL,
  `createdAt`     DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`     DATETIME(3)   NOT NULL,

  INDEX `Guarantor_applicationId_idx`(`applicationId`),
  INDEX `Guarantor_phoneHash_idx`(`phoneHash`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- FK: Guarantor → LoanApplication (cascade delete)
ALTER TABLE `Guarantor`
  ADD CONSTRAINT `Guarantor_applicationId_fkey`
  FOREIGN KEY (`applicationId`) REFERENCES `LoanApplication`(`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;
