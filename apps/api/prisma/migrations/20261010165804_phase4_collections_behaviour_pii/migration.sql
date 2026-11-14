-- CreateTable
CREATE TABLE `CollectionCase` (
    `id` VARCHAR(191) NOT NULL,
    `loanId` VARCHAR(191) NOT NULL,
    `customerId` VARCHAR(191) NOT NULL,
    `branchId` VARCHAR(191) NULL,
    `assignedToId` VARCHAR(191) NULL,
    `assignedToName` VARCHAR(191) NULL,
    `bucket` ENUM('DPD_1_7', 'DPD_8_30', 'DPD_31_60', 'DPD_61_90', 'DPD_90_PLUS') NOT NULL,
    `dpd` INTEGER NOT NULL DEFAULT 0,
    `status` ENUM('OPEN', 'IN_PROGRESS', 'PROMISE_TO_PAY', 'LEGAL', 'AGENCY', 'WRITTEN_OFF', 'SETTLED', 'CLOSED') NOT NULL DEFAULT 'OPEN',
    `priority` INTEGER NOT NULL DEFAULT 50,
    `totalOutstandingKobo` BIGINT NOT NULL DEFAULT 0,
    `closedAt` DATETIME(3) NULL,
    `closedReason` VARCHAR(191) NULL,
    `agencyId` VARCHAR(191) NULL,
    `legalCaseRef` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `CollectionCase_loanId_idx`(`loanId`),
    INDEX `CollectionCase_customerId_idx`(`customerId`),
    INDEX `CollectionCase_assignedToId_status_idx`(`assignedToId`, `status`),
    INDEX `CollectionCase_status_bucket_idx`(`status`, `bucket`),
    INDEX `CollectionCase_branchId_status_idx`(`branchId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CollectionActivity` (
    `id` VARCHAR(191) NOT NULL,
    `caseId` VARCHAR(191) NOT NULL,
    `agentId` VARCHAR(191) NULL,
    `agentName` VARCHAR(191) NOT NULL,
    `channel` ENUM('PHONE_CALL', 'SMS', 'EMAIL', 'WHATSAPP', 'FIELD_VISIT', 'PORTAL_MESSAGE', 'LEGAL_NOTICE') NOT NULL,
    `outcome` ENUM('NO_ANSWER', 'WRONG_NUMBER', 'LEFT_VOICEMAIL', 'SPOKE_TO_BORROWER', 'SPOKE_TO_THIRD_PARTY', 'PROMISE_TO_PAY', 'REFUSED_TO_PAY', 'DISPUTE_RAISED', 'COMPLAINT_LODGED', 'VISITED_ADDRESS', 'PAYMENT_MADE', 'PARTIAL_PAYMENT') NOT NULL,
    `notes` TEXT NULL,
    `contactedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `nextActionAt` DATETIME(3) NULL,
    `nextActionNote` TEXT NULL,
    `durationSecs` INTEGER NULL,
    `isFieldVisit` BOOLEAN NOT NULL DEFAULT false,
    `latitude` DOUBLE NULL,
    `longitude` DOUBLE NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `CollectionActivity_caseId_contactedAt_idx`(`caseId`, `contactedAt`),
    INDEX `CollectionActivity_agentId_contactedAt_idx`(`agentId`, `contactedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PromiseToPay` (
    `id` VARCHAR(191) NOT NULL,
    `caseId` VARCHAR(191) NOT NULL,
    `customerId` VARCHAR(191) NOT NULL,
    `amountKobo` BIGINT NOT NULL,
    `promisedDate` DATE NOT NULL,
    `status` ENUM('PENDING', 'KEPT', 'BROKEN', 'PARTIAL', 'SUPERSEDED') NOT NULL DEFAULT 'PENDING',
    `keepRate` DOUBLE NULL,
    `brokenAt` DATETIME(3) NULL,
    `keptAt` DATETIME(3) NULL,
    `createdById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `PromiseToPay_caseId_idx`(`caseId`),
    INDEX `PromiseToPay_customerId_promisedDate_idx`(`customerId`, `promisedDate`),
    INDEX `PromiseToPay_status_promisedDate_idx`(`status`, `promisedDate`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ThirdPartyAgency` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `contactEmail` VARCHAR(191) NULL,
    `contactPhone` VARCHAR(191) NULL,
    `commissionBps` INTEGER NOT NULL DEFAULT 1500,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `ThirdPartyAgency_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AgencyAssignment` (
    `id` VARCHAR(191) NOT NULL,
    `caseId` VARCHAR(191) NOT NULL,
    `agencyId` VARCHAR(191) NOT NULL,
    `assignedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `assignedById` VARCHAR(191) NULL,
    `commissionBps` INTEGER NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'ACTIVE',
    `settledAt` DATETIME(3) NULL,
    `commissionPaidAt` DATETIME(3) NULL,
    `recoveredKobo` BIGINT NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `AgencyAssignment_caseId_idx`(`caseId`),
    INDEX `AgencyAssignment_agencyId_status_idx`(`agencyId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SettlementOffer` (
    `id` VARCHAR(191) NOT NULL,
    `loanId` VARCHAR(191) NOT NULL,
    `customerId` VARCHAR(191) NOT NULL,
    `offerType` VARCHAR(191) NOT NULL,
    `originalAmountKobo` BIGINT NOT NULL,
    `settledAmountKobo` BIGINT NOT NULL,
    `waivedKobo` BIGINT NOT NULL,
    `terms` JSON NOT NULL,
    `approvalRequestId` VARCHAR(191) NULL,
    `executedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `executedById` VARCHAR(191) NULL,

    INDEX `SettlementOffer_loanId_idx`(`loanId`),
    INDEX `SettlementOffer_customerId_idx`(`customerId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `BehaviourSnapshot` (
    `id` VARCHAR(191) NOT NULL,
    `customerId` VARCHAR(191) NOT NULL,
    `snapshotDate` DATE NOT NULL,
    `onTimeRatio` DOUBLE NOT NULL DEFAULT 0,
    `avgDaysLate` DOUBLE NOT NULL DEFAULT 0,
    `paydaySensitivity` DOUBLE NOT NULL DEFAULT 0,
    `channelResponsiveness` DOUBLE NOT NULL DEFAULT 0,
    `partialPaymentRatio` DOUBLE NOT NULL DEFAULT 0,
    `avgBalanceAtDebitKobo` BIGINT NOT NULL DEFAULT 0,
    `repeatBorrowVelocity` DOUBLE NOT NULL DEFAULT 0,
    `bureauDefaultCount` INTEGER NOT NULL DEFAULT 0,
    `pdScore` DOUBLE NOT NULL DEFAULT 0.5,
    `segment` VARCHAR(191) NOT NULL DEFAULT 'UNKNOWN',
    `summaryText` TEXT NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `BehaviourSnapshot_customerId_snapshotDate_idx`(`customerId`, `snapshotDate` DESC),
    INDEX `BehaviourSnapshot_segment_idx`(`segment`),
    UNIQUE INDEX `BehaviourSnapshot_customerId_snapshotDate_key`(`customerId`, `snapshotDate`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `EarlyWarningFlag` (
    `id` VARCHAR(191) NOT NULL,
    `customerId` VARCHAR(191) NOT NULL,
    `loanId` VARCHAR(191) NOT NULL,
    `flagDate` DATE NOT NULL,
    `pdScore` DOUBLE NOT NULL,
    `triggerReason` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'OPEN',
    `actionTakenAt` DATETIME(3) NULL,
    `actionNote` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `EarlyWarningFlag_customerId_flagDate_idx`(`customerId`, `flagDate`),
    INDEX `EarlyWarningFlag_status_flagDate_idx`(`status`, `flagDate`),
    INDEX `EarlyWarningFlag_loanId_idx`(`loanId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PiiToken` (
    `id` VARCHAR(191) NOT NULL,
    `token` VARCHAR(191) NOT NULL,
    `tokenType` ENUM('CUST', 'BVN', 'NIN', 'PHONE', 'EMAIL', 'NUBAN', 'ADDR', 'DEVICE', 'FREETEXT') NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL DEFAULT 'damez',
    `scope` VARCHAR(191) NULL,
    `encValue` TEXT NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `lastUsedAt` DATETIME(3) NULL,
    `expiresAt` DATETIME(3) NULL,

    UNIQUE INDEX `PiiToken_token_key`(`token`),
    INDEX `PiiToken_tokenType_tenantId_idx`(`tokenType`, `tenantId`),
    INDEX `PiiToken_scope_idx`(`scope`),
    INDEX `PiiToken_expiresAt_idx`(`expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TokenRevealLog` (
    `id` VARCHAR(191) NOT NULL,
    `token` VARCHAR(191) NOT NULL,
    `tokenType` ENUM('CUST', 'BVN', 'NIN', 'PHONE', 'EMAIL', 'NUBAN', 'ADDR', 'DEVICE', 'FREETEXT') NOT NULL,
    `requesterId` VARCHAR(191) NULL,
    `purpose` VARCHAR(191) NOT NULL,
    `ip` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `TokenRevealLog_token_createdAt_idx`(`token`, `createdAt`),
    INDEX `TokenRevealLog_requesterId_createdAt_idx`(`requesterId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `LlmBlockLog` (
    `id` VARCHAR(191) NOT NULL,
    `feature` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NULL,
    `detectedTerms` JSON NOT NULL,
    `requestHash` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `LlmBlockLog_feature_createdAt_idx`(`feature`, `createdAt`),
    INDEX `LlmBlockLog_userId_createdAt_idx`(`userId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `LlmInferenceLog` (
    `id` VARCHAR(191) NOT NULL,
    `feature` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NULL,
    `model` VARCHAR(191) NOT NULL,
    `promptTokens` INTEGER NOT NULL,
    `completionTokens` INTEGER NOT NULL,
    `latencyMs` INTEGER NOT NULL,
    `costMicroUsd` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `LlmInferenceLog_feature_createdAt_idx`(`feature`, `createdAt`),
    INDEX `LlmInferenceLog_userId_createdAt_idx`(`userId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `CollectionCase` ADD CONSTRAINT `CollectionCase_loanId_fkey` FOREIGN KEY (`loanId`) REFERENCES `Loan`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CollectionCase` ADD CONSTRAINT `CollectionCase_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `Customer`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CollectionActivity` ADD CONSTRAINT `CollectionActivity_caseId_fkey` FOREIGN KEY (`caseId`) REFERENCES `CollectionCase`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PromiseToPay` ADD CONSTRAINT `PromiseToPay_caseId_fkey` FOREIGN KEY (`caseId`) REFERENCES `CollectionCase`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AgencyAssignment` ADD CONSTRAINT `AgencyAssignment_caseId_fkey` FOREIGN KEY (`caseId`) REFERENCES `CollectionCase`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AgencyAssignment` ADD CONSTRAINT `AgencyAssignment_agencyId_fkey` FOREIGN KEY (`agencyId`) REFERENCES `ThirdPartyAgency`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `BehaviourSnapshot` ADD CONSTRAINT `BehaviourSnapshot_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `Customer`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
