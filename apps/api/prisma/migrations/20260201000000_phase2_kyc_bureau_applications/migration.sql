-- AlterTable
ALTER TABLE `Customer` ADD COLUMN `accountNameEnc` TEXT NULL,
    ADD COLUMN `addressEnc` TEXT NULL,
    ADD COLUMN `addressVerifiedAt` DATETIME(3) NULL,
    ADD COLUMN `bankVerifiedAt` DATETIME(3) NULL,
    ADD COLUMN `birthYear` INTEGER NULL,
    ADD COLUMN `bvnPhotoHash` VARCHAR(191) NULL,
    ADD COLUMN `bvnVerifiedAt` DATETIME(3) NULL,
    ADD COLUMN `city` VARCHAR(191) NULL,
    ADD COLUMN `dobEnc` TEXT NULL,
    ADD COLUMN `emailVerifiedAt` DATETIME(3) NULL,
    ADD COLUMN `employmentStatus` VARCHAR(191) NULL,
    ADD COLUMN `faceVerifiedAt` DATETIME(3) NULL,
    ADD COLUMN `gender` VARCHAR(191) NULL,
    ADD COLUMN `kycTier` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `ninVerifiedAt` DATETIME(3) NULL,
    ADD COLUMN `phoneVerifiedAt` DATETIME(3) NULL,
    ADD COLUMN `portalRegisteredAt` DATETIME(3) NULL,
    MODIFY `bvnEnc` TEXT NULL,
    MODIFY `bvnHash` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `LoanProduct` ADD COLUMN `allowCollateral` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `allowGuarantor` BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN `description` VARCHAR(1000) NOT NULL DEFAULT '',
    ADD COLUMN `eligibilityOverrides` JSON NULL,
    ADD COLUMN `gracePeriodDays` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `insuranceFeeBps` INTEGER NOT NULL DEFAULT 50,
    ADD COLUMN `interestMethod` VARCHAR(191) NOT NULL DEFAULT 'FLAT',
    ADD COLUMN `managementFeeBps` INTEGER NOT NULL DEFAULT 100,
    ADD COLUMN `maxAge` INTEGER NOT NULL DEFAULT 65,
    ADD COLUMN `minAge` INTEGER NOT NULL DEFAULT 18,
    ADD COLUMN `minKycTier` INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN `penaltyBpsPerDay` INTEGER NOT NULL DEFAULT 25,
    ADD COLUMN `penaltyGraceDays` INTEGER NOT NULL DEFAULT 3,
    ADD COLUMN `processingFeeBps` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `requiredDocs` JSON NULL,
    ADD COLUMN `scorecardKey` VARCHAR(191) NOT NULL DEFAULT 'default';

-- CreateTable
CREATE TABLE `CustomerSession` (
    `id` VARCHAR(191) NOT NULL,
    `customerId` VARCHAR(191) NOT NULL,
    `tokenHash` VARCHAR(191) NOT NULL,
    `ip` VARCHAR(191) NULL,
    `userAgent` TEXT NULL,
    `deviceHash` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `lastActiveAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expiresAt` DATETIME(3) NOT NULL,
    `revokedAt` DATETIME(3) NULL,

    UNIQUE INDEX `CustomerSession_tokenHash_key`(`tokenHash`),
    INDEX `CustomerSession_customerId_idx`(`customerId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `OtpChallenge` (
    `id` VARCHAR(191) NOT NULL,
    `purpose` VARCHAR(191) NOT NULL,
    `customerId` VARCHAR(191) NULL,
    `destinationHash` VARCHAR(191) NOT NULL,
    `codeHash` VARCHAR(191) NOT NULL,
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `resendCount` INTEGER NOT NULL DEFAULT 0,
    `ip` VARCHAR(191) NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `consumedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `OtpChallenge_destinationHash_createdAt_idx`(`destinationHash`, `createdAt`),
    INDEX `OtpChallenge_customerId_purpose_idx`(`customerId`, `purpose`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `KycVerification` (
    `id` VARCHAR(191) NOT NULL,
    `customerId` VARCHAR(191) NOT NULL,
    `type` VARCHAR(191) NOT NULL,
    `provider` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL,
    `referenceId` VARCHAR(191) NULL,
    `matchConfidence` INTEGER NULL,
    `livenessPassed` BOOLEAN NULL,
    `summary` VARCHAR(191) NOT NULL,
    `details` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `completedAt` DATETIME(3) NULL,

    INDEX `KycVerification_customerId_type_idx`(`customerId`, `type`),
    UNIQUE INDEX `KycVerification_provider_referenceId_key`(`provider`, `referenceId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `KycDocument` (
    `id` VARCHAR(191) NOT NULL,
    `customerId` VARCHAR(191) NOT NULL,
    `applicationId` VARCHAR(191) NULL,
    `kind` VARCHAR(191) NOT NULL,
    `fileName` VARCHAR(191) NOT NULL,
    `mimeType` VARCHAR(191) NOT NULL,
    `sizeBytes` INTEGER NOT NULL,
    `sha256` VARCHAR(191) NOT NULL,
    `storageKey` VARCHAR(191) NOT NULL,
    `keyEnc` TEXT NOT NULL,
    `scanStatus` VARCHAR(191) NOT NULL DEFAULT 'PENDING',
    `scanEngine` VARCHAR(191) NULL,
    `reviewStatus` VARCHAR(191) NOT NULL DEFAULT 'PENDING',
    `reviewNote` VARCHAR(191) NULL,
    `reviewedById` VARCHAR(191) NULL,
    `reviewedAt` DATETIME(3) NULL,
    `uploadedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `deletedAt` DATETIME(3) NULL,

    INDEX `KycDocument_customerId_kind_idx`(`customerId`, `kind`),
    INDEX `KycDocument_applicationId_idx`(`applicationId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ScreeningResult` (
    `id` VARCHAR(191) NOT NULL,
    `customerId` VARCHAR(191) NOT NULL,
    `type` VARCHAR(191) NOT NULL,
    `provider` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL,
    `matchCount` INTEGER NOT NULL DEFAULT 0,
    `reference` VARCHAR(191) NULL,
    `details` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ScreeningResult_customerId_type_idx`(`customerId`, `type`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `FraudSignal` (
    `id` VARCHAR(191) NOT NULL,
    `customerId` VARCHAR(191) NOT NULL,
    `applicationId` VARCHAR(191) NULL,
    `type` VARCHAR(191) NOT NULL,
    `severity` VARCHAR(191) NOT NULL,
    `detail` VARCHAR(191) NOT NULL,
    `relatedCustomerId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `resolvedAt` DATETIME(3) NULL,
    `resolvedById` VARCHAR(191) NULL,
    `resolutionNote` VARCHAR(191) NULL,

    INDEX `FraudSignal_customerId_resolvedAt_idx`(`customerId`, `resolvedAt`),
    INDEX `FraudSignal_type_severity_idx`(`type`, `severity`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DeviceFingerprint` (
    `id` VARCHAR(191) NOT NULL,
    `customerId` VARCHAR(191) NOT NULL,
    `fingerprint` VARCHAR(191) NOT NULL,
    `ip` VARCHAR(191) NULL,
    `userAgent` TEXT NULL,
    `firstSeenAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `lastSeenAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `DeviceFingerprint_fingerprint_idx`(`fingerprint`),
    UNIQUE INDEX `DeviceFingerprint_customerId_fingerprint_key`(`customerId`, `fingerprint`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CustomerRiskFlag` (
    `id` VARCHAR(191) NOT NULL,
    `customerId` VARCHAR(191) NOT NULL,
    `type` VARCHAR(191) NOT NULL,
    `source` VARCHAR(191) NOT NULL,
    `severity` VARCHAR(191) NOT NULL,
    `detail` VARCHAR(191) NOT NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `clearedAt` DATETIME(3) NULL,

    INDEX `CustomerRiskFlag_customerId_active_idx`(`customerId`, `active`),
    INDEX `CustomerRiskFlag_source_createdAt_idx`(`source`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `BureauPull` (
    `id` VARCHAR(191) NOT NULL,
    `customerId` VARCHAR(191) NOT NULL,
    `applicationId` VARCHAR(191) NULL,
    `reportId` VARCHAR(191) NULL,
    `bureau` VARCHAR(191) NOT NULL,
    `reason` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL,
    `costKobo` BIGINT NOT NULL DEFAULT 0,
    `durationMs` INTEGER NULL,
    `requestedById` VARCHAR(191) NULL,
    `consentId` VARCHAR(191) NULL,
    `attempts` INTEGER NOT NULL DEFAULT 1,
    `error` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `BureauPull_customerId_createdAt_idx`(`customerId`, `createdAt`),
    INDEX `BureauPull_createdAt_idx`(`createdAt`),
    INDEX `BureauPull_bureau_status_idx`(`bureau`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `BureauReport` (
    `id` VARCHAR(191) NOT NULL,
    `customerId` VARCHAR(191) NOT NULL,
    `pullReason` VARCHAR(191) NOT NULL,
    `pulledAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expiresAt` DATETIME(3) NOT NULL,
    `bureausQueried` JSON NOT NULL,
    `bureausFailed` JSON NOT NULL,
    `bestScore` INTEGER NULL,
    `lowestScore` INTEGER NULL,
    `averageScore` INTEGER NULL,
    `scoreBand` VARCHAR(191) NULL,
    `worstDpdEver` INTEGER NOT NULL DEFAULT 0,
    `activeFacilityCount` INTEGER NOT NULL DEFAULT 0,
    `totalOutstandingKobo` BIGINT NOT NULL DEFAULT 0,
    `totalMonthlyObligationKobo` BIGINT NOT NULL DEFAULT 0,
    `enquiries30d` INTEGER NOT NULL DEFAULT 0,
    `enquiries90d` INTEGER NOT NULL DEFAULT 0,
    `enquiries180d` INTEGER NOT NULL DEFAULT 0,
    `defaultCount` INTEGER NOT NULL DEFAULT 0,
    `writeOffCount` INTEGER NOT NULL DEFAULT 0,
    `hasWriteOff24m` BOOLEAN NOT NULL DEFAULT false,
    `lastWriteOffMonthsAgo` INTEGER NULL,
    `hasDpd90In12m` BOOLEAN NOT NULL DEFAULT false,
    `elsewhereDefault` BOOLEAN NOT NULL DEFAULT false,
    `fraudFlag` BOOLEAN NOT NULL DEFAULT false,
    `legalActionCount` INTEGER NOT NULL DEFAULT 0,
    `soldToCollectionsCount` INTEGER NOT NULL DEFAULT 0,
    `guarantorExposureKobo` BIGINT NOT NULL DEFAULT 0,
    `thinFile` BOOLEAN NOT NULL DEFAULT false,

    INDEX `BureauReport_customerId_pulledAt_idx`(`customerId`, `pulledAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `BureauScore` (
    `id` VARCHAR(191) NOT NULL,
    `reportId` VARCHAR(191) NOT NULL,
    `bureau` VARCHAR(191) NOT NULL,
    `score` INTEGER NULL,
    `band` VARCHAR(191) NULL,
    `minScore` INTEGER NOT NULL,
    `maxScore` INTEGER NOT NULL,

    INDEX `BureauScore_reportId_idx`(`reportId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `BureauFacility` (
    `id` VARCHAR(191) NOT NULL,
    `reportId` VARCHAR(191) NOT NULL,
    `sources` JSON NOT NULL,
    `lender` VARCHAR(191) NOT NULL,
    `productType` VARCHAR(191) NOT NULL,
    `amountGrantedKobo` BIGINT NOT NULL,
    `outstandingKobo` BIGINT NOT NULL,
    `status` VARCHAR(191) NOT NULL,
    `tenorMonths` INTEGER NULL,
    `monthlyPaymentKobo` BIGINT NOT NULL DEFAULT 0,
    `openedAt` DATE NOT NULL,
    `closedAt` DATE NULL,
    `lastPaymentAt` DATE NULL,
    `worstDpd` INTEGER NOT NULL DEFAULT 0,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `legalAction` BOOLEAN NOT NULL DEFAULT false,
    `soldToCollections` BOOLEAN NOT NULL DEFAULT false,
    `isGuarantor` BOOLEAN NOT NULL DEFAULT false,
    `conflict` BOOLEAN NOT NULL DEFAULT false,
    `dedupeKey` VARCHAR(191) NOT NULL,

    INDEX `BureauFacility_reportId_idx`(`reportId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `BureauFacilityMonth` (
    `id` VARCHAR(191) NOT NULL,
    `facilityId` VARCHAR(191) NOT NULL,
    `month` CHAR(7) NOT NULL,
    `dpd` INTEGER NOT NULL,

    INDEX `BureauFacilityMonth_facilityId_idx`(`facilityId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `BureauEnquiry` (
    `id` VARCHAR(191) NOT NULL,
    `reportId` VARCHAR(191) NOT NULL,
    `lender` VARCHAR(191) NOT NULL,
    `date` DATE NOT NULL,
    `purpose` VARCHAR(191) NOT NULL,
    `sources` JSON NOT NULL,

    INDEX `BureauEnquiry_reportId_idx`(`reportId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `BureauFlag` (
    `id` VARCHAR(191) NOT NULL,
    `reportId` VARCHAR(191) NOT NULL,
    `type` VARCHAR(191) NOT NULL,
    `source` VARCHAR(191) NOT NULL,
    `detail` VARCHAR(191) NOT NULL,
    `date` DATE NOT NULL,

    INDEX `BureauFlag_reportId_idx`(`reportId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `BureauSubmission` (
    `id` VARCHAR(191) NOT NULL,
    `bureau` VARCHAR(191) NOT NULL,
    `period` CHAR(7) NOT NULL,
    `fileName` VARCHAR(191) NOT NULL,
    `format` VARCHAR(191) NOT NULL,
    `recordCount` INTEGER NOT NULL,
    `acceptedCount` INTEGER NOT NULL DEFAULT 0,
    `rejectedCount` INTEGER NOT NULL DEFAULT 0,
    `status` VARCHAR(191) NOT NULL,
    `errors` JSON NULL,
    `submittedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `BureauSubmission_bureau_period_idx`(`bureau`, `period`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Scorecard` (
    `id` VARCHAR(191) NOT NULL,
    `key` VARCHAR(191) NOT NULL,
    `version` INTEGER NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'DRAFT',
    `definition` JSON NOT NULL,
    `notes` TEXT NULL,
    `createdById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `activatedAt` DATETIME(3) NULL,
    `retiredAt` DATETIME(3) NULL,

    INDEX `Scorecard_key_status_idx`(`key`, `status`),
    UNIQUE INDEX `Scorecard_key_version_key`(`key`, `version`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `LoanApplication` (
    `id` VARCHAR(191) NOT NULL,
    `reference` VARCHAR(191) NOT NULL,
    `customerId` VARCHAR(191) NOT NULL,
    `productId` VARCHAR(191) NOT NULL,
    `branchId` VARCHAR(191) NULL,
    `channel` VARCHAR(191) NOT NULL DEFAULT 'PORTAL',
    `requestedAmountKobo` BIGINT NOT NULL,
    `tenorMonths` INTEGER NOT NULL,
    `purpose` VARCHAR(191) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'DRAFT',
    `statusReason` VARCHAR(191) NULL,
    `pricing` JSON NOT NULL,
    `kycTierAtSubmission` INTEGER NULL,
    `assignedToId` VARCHAR(191) NULL,
    `createdById` VARCHAR(191) NULL,
    `submittedAt` DATETIME(3) NULL,
    `decidedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `LoanApplication_reference_key`(`reference`),
    INDEX `LoanApplication_customerId_idx`(`customerId`),
    INDEX `LoanApplication_status_idx`(`status`),
    INDEX `LoanApplication_branchId_status_idx`(`branchId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ApplicationEvent` (
    `id` VARCHAR(191) NOT NULL,
    `applicationId` VARCHAR(191) NOT NULL,
    `fromStatus` VARCHAR(191) NULL,
    `toStatus` VARCHAR(191) NOT NULL,
    `actorType` VARCHAR(191) NOT NULL,
    `actorId` VARCHAR(191) NULL,
    `actorName` VARCHAR(191) NOT NULL,
    `reason` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ApplicationEvent_applicationId_createdAt_idx`(`applicationId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `EligibilityAssessment` (
    `id` VARCHAR(191) NOT NULL,
    `customerId` VARCHAR(191) NOT NULL,
    `applicationId` VARCHAR(191) NULL,
    `productId` VARCHAR(191) NOT NULL,
    `scorecardId` VARCHAR(191) NOT NULL,
    `requestedAmountKobo` BIGINT NOT NULL,
    `tenorMonths` INTEGER NOT NULL,
    `outcome` VARCHAR(191) NOT NULL,
    `score` INTEGER NOT NULL,
    `scoreBand` VARCHAR(191) NOT NULL,
    `maxAmountKobo` BIGINT NOT NULL,
    `maxRepaymentKobo` BIGINT NOT NULL,
    `requestedRepaymentKobo` BIGINT NOT NULL,
    `dtiBps` INTEGER NOT NULL,
    `recognisedIncomeKobo` BIGINT NOT NULL,
    `externalObligationsKobo` BIGINT NOT NULL,
    `kycTier` INTEGER NOT NULL,
    `kycCapKobo` BIGINT NOT NULL,
    `reasons` JSON NOT NULL,
    `suggestions` JSON NOT NULL,
    `alternatives` JSON NOT NULL,
    `factors` JSON NOT NULL,
    `firedRules` JSON NOT NULL,
    `facts` JSON NOT NULL,
    `bureauReportId` VARCHAR(191) NULL,
    `simulated` BOOLEAN NOT NULL DEFAULT false,
    `createdById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `EligibilityAssessment_customerId_createdAt_idx`(`customerId`, `createdAt`),
    INDEX `EligibilityAssessment_applicationId_idx`(`applicationId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `BankStatementAnalysis` (
    `id` VARCHAR(191) NOT NULL,
    `customerId` VARCHAR(191) NOT NULL,
    `applicationId` VARCHAR(191) NULL,
    `source` VARCHAR(191) NOT NULL,
    `documentId` VARCHAR(191) NULL,
    `periodMonths` INTEGER NOT NULL,
    `avgMonthlyInflowKobo` BIGINT NOT NULL,
    `inflowStability` INTEGER NOT NULL,
    `avgBalanceKobo` BIGINT NOT NULL,
    `gamblingFlag` BOOLEAN NOT NULL DEFAULT false,
    `overdraftFlag` BOOLEAN NOT NULL DEFAULT false,
    `salaryDetected` BOOLEAN NOT NULL DEFAULT false,
    `salaryDay` INTEGER NULL,
    `monthly` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `BankStatementAnalysis_customerId_createdAt_idx`(`customerId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `CustomerSession` ADD CONSTRAINT `CustomerSession_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `Customer`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `KycVerification` ADD CONSTRAINT `KycVerification_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `Customer`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `KycDocument` ADD CONSTRAINT `KycDocument_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `Customer`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ScreeningResult` ADD CONSTRAINT `ScreeningResult_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `Customer`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `FraudSignal` ADD CONSTRAINT `FraudSignal_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `Customer`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DeviceFingerprint` ADD CONSTRAINT `DeviceFingerprint_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `Customer`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CustomerRiskFlag` ADD CONSTRAINT `CustomerRiskFlag_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `Customer`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `BureauPull` ADD CONSTRAINT `BureauPull_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `Customer`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `BureauReport` ADD CONSTRAINT `BureauReport_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `Customer`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `BureauScore` ADD CONSTRAINT `BureauScore_reportId_fkey` FOREIGN KEY (`reportId`) REFERENCES `BureauReport`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `BureauFacility` ADD CONSTRAINT `BureauFacility_reportId_fkey` FOREIGN KEY (`reportId`) REFERENCES `BureauReport`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `BureauFacilityMonth` ADD CONSTRAINT `BureauFacilityMonth_facilityId_fkey` FOREIGN KEY (`facilityId`) REFERENCES `BureauFacility`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `BureauEnquiry` ADD CONSTRAINT `BureauEnquiry_reportId_fkey` FOREIGN KEY (`reportId`) REFERENCES `BureauReport`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `BureauFlag` ADD CONSTRAINT `BureauFlag_reportId_fkey` FOREIGN KEY (`reportId`) REFERENCES `BureauReport`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LoanApplication` ADD CONSTRAINT `LoanApplication_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `Customer`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LoanApplication` ADD CONSTRAINT `LoanApplication_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `LoanProduct`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ApplicationEvent` ADD CONSTRAINT `ApplicationEvent_applicationId_fkey` FOREIGN KEY (`applicationId`) REFERENCES `LoanApplication`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `EligibilityAssessment` ADD CONSTRAINT `EligibilityAssessment_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `Customer`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `EligibilityAssessment` ADD CONSTRAINT `EligibilityAssessment_applicationId_fkey` FOREIGN KEY (`applicationId`) REFERENCES `LoanApplication`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `BankStatementAnalysis` ADD CONSTRAINT `BankStatementAnalysis_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `Customer`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

