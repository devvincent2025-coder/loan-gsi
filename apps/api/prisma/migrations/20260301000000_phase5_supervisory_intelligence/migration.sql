-- Phase 5: Supervisory Intelligence pre-aggregated snapshots
-- Migration: 20260301000000_phase5_supervisory_intelligence

-- CreateTable
CREATE TABLE IF NOT EXISTS `PortfolioDailyMetrics` (
    `id` VARCHAR(191) NOT NULL,
    `snapshotDate` DATE NOT NULL,
    `totalDisbursedKobo` BIGINT NOT NULL DEFAULT 0,
    `totalOutstandingKobo` BIGINT NOT NULL DEFAULT 0,
    `totalRepaidKobo` BIGINT NOT NULL DEFAULT 0,
    `par30Ratio` DOUBLE NOT NULL DEFAULT 0,
    `par90Ratio` DOUBLE NOT NULL DEFAULT 0,
    `nplRatio` DOUBLE NOT NULL DEFAULT 0,
    `activeLoansCount` INTEGER NOT NULL DEFAULT 0,
    `disbursementsCount` INTEGER NOT NULL DEFAULT 0,
    `disbursementsKobo` BIGINT NOT NULL DEFAULT 0,
    `collectionEfficiency` DOUBLE NOT NULL DEFAULT 0,
    `yieldBps` INTEGER NOT NULL DEFAULT 0,
    `costOfRiskBps` INTEGER NOT NULL DEFAULT 0,
    `eclTotalKobo` BIGINT NOT NULL DEFAULT 0,
    `avgLoanAmountKobo` BIGINT NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `PortfolioDailyMetrics_snapshotDate_key`(`snapshotDate`),
    INDEX `PortfolioDailyMetrics_snapshotDate_idx`(`snapshotDate`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE IF NOT EXISTS `BranchDailyMetrics` (
    `id` VARCHAR(191) NOT NULL,
    `snapshotDate` DATE NOT NULL,
    `branchId` VARCHAR(191) NOT NULL,
    `branchName` VARCHAR(191) NOT NULL,
    `activeLoansCount` INTEGER NOT NULL DEFAULT 0,
    `disbursementsKobo` BIGINT NOT NULL DEFAULT 0,
    `disbursementsCount` INTEGER NOT NULL DEFAULT 0,
    `outstandingKobo` BIGINT NOT NULL DEFAULT 0,
    `par30Ratio` DOUBLE NOT NULL DEFAULT 0,
    `par90Ratio` DOUBLE NOT NULL DEFAULT 0,
    `nplRatio` DOUBLE NOT NULL DEFAULT 0,
    `collectionEfficiency` DOUBLE NOT NULL DEFAULT 0,
    `agentsCount` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `BranchDailyMetrics_snapshotDate_branchId_key`(`snapshotDate`, `branchId`),
    INDEX `BranchDailyMetrics_snapshotDate_idx`(`snapshotDate`),
    INDEX `BranchDailyMetrics_branchId_idx`(`branchId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE IF NOT EXISTS `AgentDailyMetrics` (
    `id` VARCHAR(191) NOT NULL,
    `snapshotDate` DATE NOT NULL,
    `agentId` VARCHAR(191) NOT NULL,
    `agentName` VARCHAR(191) NOT NULL,
    `branchId` VARCHAR(191) NOT NULL,
    `casesHandled` INTEGER NOT NULL DEFAULT 0,
    `ptpCreated` INTEGER NOT NULL DEFAULT 0,
    `ptpKept` INTEGER NOT NULL DEFAULT 0,
    `amountRecoveredKobo` BIGINT NOT NULL DEFAULT 0,
    `callsMade` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `AgentDailyMetrics_snapshotDate_agentId_key`(`snapshotDate`, `agentId`),
    INDEX `AgentDailyMetrics_snapshotDate_idx`(`snapshotDate`),
    INDEX `AgentDailyMetrics_agentId_idx`(`agentId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE IF NOT EXISTS `ProductDailyMetrics` (
    `id` VARCHAR(191) NOT NULL,
    `snapshotDate` DATE NOT NULL,
    `productId` VARCHAR(191) NOT NULL,
    `productName` VARCHAR(191) NOT NULL,
    `activeLoansCount` INTEGER NOT NULL DEFAULT 0,
    `disbursedKobo` BIGINT NOT NULL DEFAULT 0,
    `outstandingKobo` BIGINT NOT NULL DEFAULT 0,
    `par30Ratio` DOUBLE NOT NULL DEFAULT 0,
    `nplRatio` DOUBLE NOT NULL DEFAULT 0,
    `avgTicketKobo` BIGINT NOT NULL DEFAULT 0,
    `yieldBps` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `ProductDailyMetrics_snapshotDate_productId_key`(`snapshotDate`, `productId`),
    INDEX `ProductDailyMetrics_snapshotDate_idx`(`snapshotDate`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE IF NOT EXISTS `VintageCurve` (
    `id` VARCHAR(191) NOT NULL,
    `cohortMonth` DATE NOT NULL,
    `monthOnBook` INTEGER NOT NULL,
    `disbursedKobo` BIGINT NOT NULL,
    `outstandingKobo` BIGINT NOT NULL,
    `par30Kobo` BIGINT NOT NULL DEFAULT 0,
    `par90Kobo` BIGINT NOT NULL DEFAULT 0,
    `lossKobo` BIGINT NOT NULL DEFAULT 0,
    `loanCount` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `VintageCurve_cohortMonth_monthOnBook_key`(`cohortMonth`, `monthOnBook`),
    INDEX `VintageCurve_cohortMonth_idx`(`cohortMonth`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE IF NOT EXISTS `CollectionsDaily` (
    `id` VARCHAR(191) NOT NULL,
    `snapshotDate` DATE NOT NULL,
    `branchId` VARCHAR(191) NULL,
    `openCasesCount` INTEGER NOT NULL DEFAULT 0,
    `resolvedCasesCount` INTEGER NOT NULL DEFAULT 0,
    `ptpKeptRate` DOUBLE NOT NULL DEFAULT 0,
    `ptpBrokenRate` DOUBLE NOT NULL DEFAULT 0,
    `cureRate30d` DOUBLE NOT NULL DEFAULT 0,
    `amountRecoveredKobo` BIGINT NOT NULL DEFAULT 0,
    `agencyAssignedCount` INTEGER NOT NULL DEFAULT 0,
    `writeOffKobo` BIGINT NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `CollectionsDaily_snapshotDate_branchId_key`(`snapshotDate`, `branchId`),
    INDEX `CollectionsDaily_snapshotDate_idx`(`snapshotDate`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE IF NOT EXISTS `DebitDaily` (
    `id` VARCHAR(191) NOT NULL,
    `snapshotDate` DATE NOT NULL,
    `bankCode` VARCHAR(191) NULL,
    `totalAttempts` INTEGER NOT NULL DEFAULT 0,
    `successCount` INTEGER NOT NULL DEFAULT 0,
    `failureCount` INTEGER NOT NULL DEFAULT 0,
    `successAmountKobo` BIGINT NOT NULL DEFAULT 0,
    `failureAmountKobo` BIGINT NOT NULL DEFAULT 0,
    `gsiTriggeredCount` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `DebitDaily_snapshotDate_bankCode_key`(`snapshotDate`, `bankCode`),
    INDEX `DebitDaily_snapshotDate_idx`(`snapshotDate`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE IF NOT EXISTS `BureauDistributionDaily` (
    `id` VARCHAR(191) NOT NULL,
    `snapshotDate` DATE NOT NULL,
    `scoreBucket` VARCHAR(191) NOT NULL,
    `customerCount` INTEGER NOT NULL DEFAULT 0,
    `avgScore` DOUBLE NOT NULL DEFAULT 0,
    `par30Ratio` DOUBLE NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `BureauDistributionDaily_snapshotDate_scoreBucket_key`(`snapshotDate`, `scoreBucket`),
    INDEX `BureauDistributionDaily_snapshotDate_idx`(`snapshotDate`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE IF NOT EXISTS `ApprovalsQueueSnapshot` (
    `id` VARCHAR(191) NOT NULL,
    `snapshotDate` DATE NOT NULL,
    `actionType` VARCHAR(191) NOT NULL,
    `pendingCount` INTEGER NOT NULL DEFAULT 0,
    `escalatedCount` INTEGER NOT NULL DEFAULT 0,
    `avgAgeHours` DOUBLE NOT NULL DEFAULT 0,
    `oldest` DATETIME(3) NULL,
    `pendingAmountKobo` BIGINT NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `ApprovalsQueueSnapshot_snapshotDate_actionType_key`(`snapshotDate`, `actionType`),
    INDEX `ApprovalsQueueSnapshot_snapshotDate_idx`(`snapshotDate`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE IF NOT EXISTS `AnomalyRecord` (
    `id` VARCHAR(191) NOT NULL,
    `detectedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `metric` VARCHAR(191) NOT NULL,
    `dimension` VARCHAR(191) NULL,
    `severity` ENUM('INFO', 'WARNING', 'CRITICAL') NOT NULL,
    `status` ENUM('OPEN', 'ACKNOWLEDGED', 'RESOLVED') NOT NULL DEFAULT 'OPEN',
    `zScore` DOUBLE NULL,
    `baseline` DOUBLE NULL,
    `actual` DOUBLE NULL,
    `description` TEXT NOT NULL,
    `llmExplanation` TEXT NULL,
    `llmActions` JSON NULL,
    `acknowledgedById` VARCHAR(191) NULL,
    `acknowledgedAt` DATETIME(3) NULL,
    `resolvedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `AnomalyRecord_detectedAt_severity_idx`(`detectedAt`, `severity`),
    INDEX `AnomalyRecord_status_severity_idx`(`status`, `severity`),
    INDEX `AnomalyRecord_metric_dimension_idx`(`metric`, `dimension`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE IF NOT EXISTS `ExecutiveBriefing` (
    `id` VARCHAR(191) NOT NULL,
    `briefingType` ENUM('DAILY_MORNING', 'WEEKLY_SUMMARY', 'MONTHLY_BOARD') NOT NULL,
    `status` ENUM('DRAFT', 'READY', 'FAILED') NOT NULL DEFAULT 'DRAFT',
    `periodStart` DATETIME(3) NOT NULL,
    `periodEnd` DATETIME(3) NOT NULL,
    `targetRoleKey` VARCHAR(191) NULL,
    `targetBranchId` VARCHAR(191) NULL,
    `headline` TEXT NOT NULL,
    `bodyMd` MEDIUMTEXT NULL,
    `metricsSnapshot` JSON NULL,
    `anomalyIds` JSON NULL,
    `promptVersion` VARCHAR(191) NOT NULL DEFAULT 'v1',
    `modelUsed` VARCHAR(191) NULL,
    `promptTokens` INTEGER NOT NULL DEFAULT 0,
    `completionTokens` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `ExecutiveBriefing_briefingType_createdAt_idx`(`briefingType`, `createdAt`),
    INDEX `ExecutiveBriefing_status_briefingType_idx`(`status`, `briefingType`),
    INDEX `ExecutiveBriefing_targetBranchId_idx`(`targetBranchId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE IF NOT EXISTS `ExecChatSession` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `ExecChatSession_userId_createdAt_idx`(`userId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE IF NOT EXISTS `ExecChatMessage` (
    `id` VARCHAR(191) NOT NULL,
    `sessionId` VARCHAR(191) NOT NULL,
    `briefingId` VARCHAR(191) NULL,
    `role` VARCHAR(191) NOT NULL,
    `content` MEDIUMTEXT NOT NULL,
    `toolCalls` JSON NULL,
    `toolResults` JSON NULL,
    `pinned` TINYINT(1) NOT NULL DEFAULT 0,
    `promptTokens` INTEGER NOT NULL DEFAULT 0,
    `completionTokens` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ExecChatMessage_sessionId_createdAt_idx`(`sessionId`, `createdAt`),
    INDEX `ExecChatMessage_pinned_idx`(`pinned`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE IF NOT EXISTS `ExecPreference` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `briefingTime` VARCHAR(191) NOT NULL DEFAULT '07:00',
    `channels` JSON NOT NULL DEFAULT ('[]'),
    `verbosity` VARCHAR(191) NOT NULL DEFAULT 'standard',
    `timezone` VARCHAR(191) NOT NULL DEFAULT 'Africa/Lagos',
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ExecPreference_userId_key`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `ExecChatMessage` ADD CONSTRAINT `ExecChatMessage_sessionId_fkey` FOREIGN KEY (`sessionId`) REFERENCES `ExecChatSession`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ExecChatMessage` ADD CONSTRAINT `ExecChatMessage_briefingId_fkey` FOREIGN KEY (`briefingId`) REFERENCES `ExecutiveBriefing`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
