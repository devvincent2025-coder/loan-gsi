-- CreateTable
CREATE TABLE `LoanOffer` (
    `id` VARCHAR(191) NOT NULL,
    `applicationId` VARCHAR(191) NOT NULL,
    `offerNumber` VARCHAR(191) NOT NULL,
    `isCounterOffer` BOOLEAN NOT NULL DEFAULT false,
    `principalKobo` BIGINT NOT NULL,
    `tenorMonths` INTEGER NOT NULL,
    `monthlyRateBps` INTEGER NOT NULL,
    `interestMethod` VARCHAR(191) NOT NULL,
    `totalInterestKobo` BIGINT NOT NULL,
    `totalFeesKobo` BIGINT NOT NULL,
    `totalPenaltyProjectedKobo` BIGINT NOT NULL DEFAULT 0,
    `totalCostOfCreditKobo` BIGINT NOT NULL,
    `totalRepayableKobo` BIGINT NOT NULL,
    `gsiBps` INTEGER NOT NULL DEFAULT 0,
    `scheduleJson` JSON NOT NULL,
    `autodebitConsentRequired` BOOLEAN NOT NULL DEFAULT true,
    `gsiConsentRequired` BOOLEAN NOT NULL DEFAULT true,
    `coolingOffHours` INTEGER NOT NULL DEFAULT 48,
    `status` ENUM('DRAFT', 'SENT', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'WITHDRAWN') NOT NULL DEFAULT 'DRAFT',
    `pdfStorageKey` VARCHAR(191) NULL,
    `sentAt` DATETIME(3) NULL,
    `expiresAt` DATETIME(3) NULL,
    `acceptedAt` DATETIME(3) NULL,
    `declinedAt` DATETIME(3) NULL,
    `declineReason` VARCHAR(191) NULL,
    `createdById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `LoanOffer_offerNumber_key`(`offerNumber`),
    INDEX `LoanOffer_applicationId_status_idx`(`applicationId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `OfferAcceptance` (
    `id` VARCHAR(191) NOT NULL,
    `offerId` VARCHAR(191) NOT NULL,
    `otpChallengeId` VARCHAR(191) NULL,
    `eSignatureName` VARCHAR(191) NOT NULL,
    `eSignatureHash` VARCHAR(191) NOT NULL,
    `acceptedTermsVersion` VARCHAR(191) NOT NULL,
    `ip` VARCHAR(191) NULL,
    `userAgent` TEXT NULL,
    `coolingOffEndsAt` DATETIME(3) NOT NULL,
    `coolingOffWaived` BOOLEAN NOT NULL DEFAULT false,
    `coolingOffWaivedReason` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `OfferAcceptance_offerId_key`(`offerId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Loan` (
    `id` VARCHAR(191) NOT NULL,
    `applicationId` VARCHAR(191) NOT NULL,
    `offerId` VARCHAR(191) NULL,
    `customerId` VARCHAR(191) NOT NULL,
    `productId` VARCHAR(191) NOT NULL,
    `branchId` VARCHAR(191) NULL,
    `reference` VARCHAR(191) NOT NULL,
    `principalKobo` BIGINT NOT NULL,
    `disbursedAmountKobo` BIGINT NOT NULL,
    `tenorMonths` INTEGER NOT NULL,
    `monthlyRateBps` INTEGER NOT NULL,
    `interestMethod` VARCHAR(191) NOT NULL,
    `totalCostOfCreditKobo` BIGINT NOT NULL,
    `status` ENUM('DISBURSED', 'ACTIVE', 'Unpaid', 'RESTRUCTURED', 'CLOSED', 'WRITTEN_OFF') NOT NULL DEFAULT 'DISBURSED',
    `disbursedAt` DATETIME(3) NOT NULL,
    `maturityDate` DATETIME(3) NOT NULL,
    `outstandingPrincipalKobo` BIGINT NOT NULL DEFAULT 0,
    `dpd` INTEGER NOT NULL DEFAULT 0,
    `ifrsStage` INTEGER NOT NULL DEFAULT 1,
    `restructureCount` INTEGER NOT NULL DEFAULT 0,
    `closedAt` DATETIME(3) NULL,
    `writtenOffAt` DATETIME(3) NULL,
    `writtenOffAmountKobo` BIGINT NULL,
    `primaryLinkedAccountId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Loan_applicationId_key`(`applicationId`),
    UNIQUE INDEX `Loan_reference_key`(`reference`),
    INDEX `Loan_customerId_idx`(`customerId`),
    INDEX `Loan_status_idx`(`status`),
    INDEX `Loan_branchId_status_idx`(`branchId`, `status`),
    INDEX `Loan_dpd_idx`(`dpd`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `LoanInstallment` (
    `id` VARCHAR(191) NOT NULL,
    `loanId` VARCHAR(191) NOT NULL,
    `seq` INTEGER NOT NULL,
    `dueDate` DATE NOT NULL,
    `principalKobo` BIGINT NOT NULL,
    `interestKobo` BIGINT NOT NULL,
    `feeKobo` BIGINT NOT NULL DEFAULT 0,
    `totalKobo` BIGINT NOT NULL,
    `paidKobo` BIGINT NOT NULL DEFAULT 0,
    `penaltyAccruedKobo` BIGINT NOT NULL DEFAULT 0,
    `status` ENUM('PENDING', 'PARTIAL', 'PAID', 'OVERDUE') NOT NULL DEFAULT 'PENDING',
    `paidAt` DATETIME(3) NULL,

    INDEX `LoanInstallment_loanId_status_idx`(`loanId`, `status`),
    INDEX `LoanInstallment_dueDate_status_idx`(`dueDate`, `status`),
    UNIQUE INDEX `LoanInstallment_loanId_seq_key`(`loanId`, `seq`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `LoanRestructure` (
    `id` VARCHAR(191) NOT NULL,
    `loanId` VARCHAR(191) NOT NULL,
    `approvalRequestId` VARCHAR(191) NULL,
    `reason` VARCHAR(191) NOT NULL,
    `oldSchedule` JSON NOT NULL,
    `newSchedule` JSON NOT NULL,
    `newTenorMonths` INTEGER NOT NULL,
    `newMonthlyRateBps` INTEGER NOT NULL,
    `requestedById` VARCHAR(191) NULL,
    `appliedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `LoanRestructure_loanId_idx`(`loanId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `LinkedAccount` (
    `id` VARCHAR(191) NOT NULL,
    `customerId` VARCHAR(191) NOT NULL,
    `accountNumberEnc` TEXT NOT NULL,
    `accountNumberHash` VARCHAR(191) NOT NULL,
    `bankCode` VARCHAR(191) NOT NULL,
    `bankName` VARCHAR(191) NOT NULL,
    `accountNameEnc` TEXT NOT NULL,
    `isPrimary` BOOLEAN NOT NULL DEFAULT false,
    `priority` INTEGER NOT NULL DEFAULT 1,
    `status` ENUM('PENDING', 'VERIFIED', 'FAILED', 'REMOVED') NOT NULL DEFAULT 'PENDING',
    `verificationMethod` VARCHAR(191) NULL,
    `verificationRef` VARCHAR(191) NULL,
    `bvnNameMatchScore` INTEGER NULL,
    `failureReason` VARCHAR(191) NULL,
    `verifiedAt` DATETIME(3) NULL,
    `removedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `LinkedAccount_customerId_status_idx`(`customerId`, `status`),
    UNIQUE INDEX `LinkedAccount_customerId_accountNumberHash_bankCode_key`(`customerId`, `accountNumberHash`, `bankCode`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Mandate` (
    `id` VARCHAR(191) NOT NULL,
    `customerId` VARCHAR(191) NOT NULL,
    `loanId` VARCHAR(191) NULL,
    `linkedAccountId` VARCHAR(191) NULL,
    `type` ENUM('NIBSS_EMANDATE', 'CARD_TOKEN', 'GSI') NOT NULL,
    `provider` VARCHAR(191) NOT NULL,
    `status` ENUM('PENDING', 'ACTIVE', 'FAILED', 'REVOKED', 'EXPIRED') NOT NULL DEFAULT 'PENDING',
    `consentId` VARCHAR(191) NULL,
    `tokenRefEnc` TEXT NULL,
    `cardLast4` VARCHAR(191) NULL,
    `cardBin` VARCHAR(191) NULL,
    `providerRef` VARCHAR(191) NULL,
    `priority` INTEGER NOT NULL DEFAULT 1,
    `activatedAt` DATETIME(3) NULL,
    `revokedAt` DATETIME(3) NULL,
    `expiresAt` DATETIME(3) NULL,
    `failureReason` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Mandate_customerId_status_idx`(`customerId`, `status`),
    INDEX `Mandate_loanId_idx`(`loanId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DebitAttempt` (
    `id` VARCHAR(191) NOT NULL,
    `loanId` VARCHAR(191) NOT NULL,
    `installmentId` VARCHAR(191) NULL,
    `mandateId` VARCHAR(191) NULL,
    `linkedAccountId` VARCHAR(191) NULL,
    `method` ENUM('NIBSS_EMANDATE', 'CARD_TOKEN', 'GSI') NOT NULL,
    `retryStage` VARCHAR(191) NOT NULL,
    `attemptNumber` INTEGER NOT NULL DEFAULT 1,
    `amountKobo` BIGINT NOT NULL,
    `collectedKobo` BIGINT NOT NULL DEFAULT 0,
    `status` ENUM('SCHEDULED', 'INITIATED', 'SUCCESS', 'PARTIAL', 'FAILED', 'CANCELLED') NOT NULL DEFAULT 'SCHEDULED',
    `providerRef` VARCHAR(191) NULL,
    `failureReason` VARCHAR(191) NULL,
    `idempotencyKey` VARCHAR(191) NOT NULL,
    `scheduledFor` DATETIME(3) NOT NULL,
    `executedAt` DATETIME(3) NULL,
    `repaymentId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `DebitAttempt_idempotencyKey_key`(`idempotencyKey`),
    INDEX `DebitAttempt_loanId_status_idx`(`loanId`, `status`),
    INDEX `DebitAttempt_scheduledFor_status_idx`(`scheduledFor`, `status`),
    INDEX `DebitAttempt_method_status_idx`(`method`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Repayment` (
    `id` VARCHAR(191) NOT NULL,
    `loanId` VARCHAR(191) NOT NULL,
    `receiptNumber` VARCHAR(191) NOT NULL,
    `kind` ENUM('SCHEDULED', 'EARLY', 'PART', 'TOPUP_NET', 'RECOVERY') NOT NULL DEFAULT 'SCHEDULED',
    `method` ENUM('AUTODEBIT_MANDATE', 'AUTODEBIT_GSI', 'MANUAL', 'CASH', 'TRANSFER') NOT NULL,
    `amountKobo` BIGINT NOT NULL,
    `allocatedPenaltyKobo` BIGINT NOT NULL DEFAULT 0,
    `allocatedFeeKobo` BIGINT NOT NULL DEFAULT 0,
    `allocatedInterestKobo` BIGINT NOT NULL DEFAULT 0,
    `allocatedPrincipalKobo` BIGINT NOT NULL DEFAULT 0,
    `debitAttemptId` VARCHAR(191) NULL,
    `journalEntryId` VARCHAR(191) NULL,
    `createdById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `Repayment_receiptNumber_key`(`receiptNumber`),
    INDEX `Repayment_loanId_createdAt_idx`(`loanId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `LedgerAccount` (
    `id` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `type` ENUM('ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE') NOT NULL,
    `normalSide` ENUM('DEBIT', 'CREDIT') NOT NULL,
    `isSystem` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `LedgerAccount_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `JournalEntry` (
    `id` VARCHAR(191) NOT NULL,
    `reference` VARCHAR(191) NOT NULL,
    `date` DATE NOT NULL,
    `memo` VARCHAR(191) NOT NULL,
    `sourceType` ENUM('DISBURSEMENT', 'ACCRUAL', 'REPAYMENT', 'FEE', 'PENALTY', 'WAIVER', 'WRITE_OFF', 'RECOVERY', 'RECONCILIATION_ADJUSTMENT', 'MANUAL') NOT NULL,
    `sourceId` VARCHAR(191) NULL,
    `loanId` VARCHAR(191) NULL,
    `reversalOfId` VARCHAR(191) NULL,
    `createdById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `JournalEntry_reference_key`(`reference`),
    UNIQUE INDEX `JournalEntry_reversalOfId_key`(`reversalOfId`),
    INDEX `JournalEntry_date_idx`(`date`),
    INDEX `JournalEntry_sourceType_sourceId_idx`(`sourceType`, `sourceId`),
    INDEX `JournalEntry_loanId_idx`(`loanId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Posting` (
    `id` VARCHAR(191) NOT NULL,
    `journalEntryId` VARCHAR(191) NOT NULL,
    `accountId` VARCHAR(191) NOT NULL,
    `loanId` VARCHAR(191) NULL,
    `side` ENUM('DEBIT', 'CREDIT') NOT NULL,
    `amountKobo` BIGINT NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Posting_journalEntryId_idx`(`journalEntryId`),
    INDEX `Posting_accountId_createdAt_idx`(`accountId`, `createdAt`),
    INDEX `Posting_loanId_idx`(`loanId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `LoanStagingSnapshot` (
    `id` VARCHAR(191) NOT NULL,
    `loanId` VARCHAR(191) NOT NULL,
    `asOfDate` DATE NOT NULL,
    `stage` INTEGER NOT NULL,
    `dpd` INTEGER NOT NULL,
    `pdBps` INTEGER NOT NULL,
    `lgdBps` INTEGER NOT NULL,
    `eadKobo` BIGINT NOT NULL,
    `eclKobo` BIGINT NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `LoanStagingSnapshot_asOfDate_stage_idx`(`asOfDate`, `stage`),
    UNIQUE INDEX `LoanStagingSnapshot_loanId_asOfDate_key`(`loanId`, `asOfDate`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DisbursementRequest` (
    `id` VARCHAR(191) NOT NULL,
    `loanId` VARCHAR(191) NOT NULL,
    `linkedAccountId` VARCHAR(191) NULL,
    `amountKobo` BIGINT NOT NULL,
    `provider` VARCHAR(191) NOT NULL,
    `method` ENUM('AUTOMATED', 'MANUAL') NOT NULL DEFAULT 'AUTOMATED',
    `status` ENUM('PENDING', 'NAME_ENQUIRY_DONE', 'PROCESSING', 'SUCCESS', 'FAILED', 'REVERSED') NOT NULL DEFAULT 'PENDING',
    `idempotencyKey` VARCHAR(191) NOT NULL,
    `nameEnquiryResult` JSON NULL,
    `providerRef` VARCHAR(191) NULL,
    `failureReason` VARCHAR(191) NULL,
    `retryCount` INTEGER NOT NULL DEFAULT 0,
    `approvalRequestId` VARCHAR(191) NULL,
    `initiatedById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `completedAt` DATETIME(3) NULL,

    UNIQUE INDEX `DisbursementRequest_loanId_key`(`loanId`),
    UNIQUE INDEX `DisbursementRequest_idempotencyKey_key`(`idempotencyKey`),
    INDEX `DisbursementRequest_status_idx`(`status`),
    INDEX `DisbursementRequest_provider_providerRef_idx`(`provider`, `providerRef`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SettlementRecord` (
    `id` VARCHAR(191) NOT NULL,
    `provider` VARCHAR(191) NOT NULL,
    `externalRef` VARCHAR(191) NOT NULL,
    `type` VARCHAR(191) NOT NULL,
    `amountKobo` BIGINT NOT NULL,
    `valueDate` DATE NOT NULL,
    `rawPayload` JSON NOT NULL,
    `matchedDisbursementId` VARCHAR(191) NULL,
    `matchedRepaymentId` VARCHAR(191) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'UNMATCHED',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `SettlementRecord_status_valueDate_idx`(`status`, `valueDate`),
    UNIQUE INDEX `SettlementRecord_provider_externalRef_key`(`provider`, `externalRef`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ReconciliationException` (
    `id` VARCHAR(191) NOT NULL,
    `settlementRecordId` VARCHAR(191) NOT NULL,
    `reason` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'OPEN',
    `resolvedById` VARCHAR(191) NULL,
    `resolvedAt` DATETIME(3) NULL,
    `note` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ReconciliationException_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `LoanOffer` ADD CONSTRAINT `LoanOffer_applicationId_fkey` FOREIGN KEY (`applicationId`) REFERENCES `LoanApplication`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `OfferAcceptance` ADD CONSTRAINT `OfferAcceptance_offerId_fkey` FOREIGN KEY (`offerId`) REFERENCES `LoanOffer`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Loan` ADD CONSTRAINT `Loan_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `Customer`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Loan` ADD CONSTRAINT `Loan_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `LoanProduct`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Loan` ADD CONSTRAINT `Loan_applicationId_fkey` FOREIGN KEY (`applicationId`) REFERENCES `LoanApplication`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LoanInstallment` ADD CONSTRAINT `LoanInstallment_loanId_fkey` FOREIGN KEY (`loanId`) REFERENCES `Loan`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LoanRestructure` ADD CONSTRAINT `LoanRestructure_loanId_fkey` FOREIGN KEY (`loanId`) REFERENCES `Loan`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LinkedAccount` ADD CONSTRAINT `LinkedAccount_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `Customer`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Mandate` ADD CONSTRAINT `Mandate_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `Customer`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Mandate` ADD CONSTRAINT `Mandate_loanId_fkey` FOREIGN KEY (`loanId`) REFERENCES `Loan`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Mandate` ADD CONSTRAINT `Mandate_linkedAccountId_fkey` FOREIGN KEY (`linkedAccountId`) REFERENCES `LinkedAccount`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DebitAttempt` ADD CONSTRAINT `DebitAttempt_loanId_fkey` FOREIGN KEY (`loanId`) REFERENCES `Loan`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DebitAttempt` ADD CONSTRAINT `DebitAttempt_mandateId_fkey` FOREIGN KEY (`mandateId`) REFERENCES `Mandate`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DebitAttempt` ADD CONSTRAINT `DebitAttempt_linkedAccountId_fkey` FOREIGN KEY (`linkedAccountId`) REFERENCES `LinkedAccount`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Repayment` ADD CONSTRAINT `Repayment_loanId_fkey` FOREIGN KEY (`loanId`) REFERENCES `Loan`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `JournalEntry` ADD CONSTRAINT `JournalEntry_reversalOfId_fkey` FOREIGN KEY (`reversalOfId`) REFERENCES `JournalEntry`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Posting` ADD CONSTRAINT `Posting_journalEntryId_fkey` FOREIGN KEY (`journalEntryId`) REFERENCES `JournalEntry`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Posting` ADD CONSTRAINT `Posting_accountId_fkey` FOREIGN KEY (`accountId`) REFERENCES `LedgerAccount`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LoanStagingSnapshot` ADD CONSTRAINT `LoanStagingSnapshot_loanId_fkey` FOREIGN KEY (`loanId`) REFERENCES `Loan`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DisbursementRequest` ADD CONSTRAINT `DisbursementRequest_loanId_fkey` FOREIGN KEY (`loanId`) REFERENCES `Loan`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DisbursementRequest` ADD CONSTRAINT `DisbursementRequest_linkedAccountId_fkey` FOREIGN KEY (`linkedAccountId`) REFERENCES `LinkedAccount`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ReconciliationException` ADD CONSTRAINT `ReconciliationException_settlementRecordId_fkey` FOREIGN KEY (`settlementRecordId`) REFERENCES `SettlementRecord`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
