-- CreateTable
CREATE TABLE `Branch` (
    `id` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `state` VARCHAR(191) NOT NULL,
    `city` VARCHAR(191) NOT NULL,
    `address` VARCHAR(191) NULL,
    `isHeadOffice` BOOLEAN NOT NULL DEFAULT false,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Branch_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Role` (
    `id` VARCHAR(191) NOT NULL,
    `key` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` VARCHAR(191) NOT NULL DEFAULT '',
    `isSystem` BOOLEAN NOT NULL DEFAULT false,
    `branchScoped` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Role_key_key`(`key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Permission` (
    `id` VARCHAR(191) NOT NULL,
    `key` VARCHAR(191) NOT NULL,
    `module` VARCHAR(191) NOT NULL,
    `description` VARCHAR(191) NOT NULL,

    UNIQUE INDEX `Permission_key_key`(`key`),
    INDEX `Permission_module_idx`(`module`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `RolePermission` (
    `roleId` VARCHAR(191) NOT NULL,
    `permissionId` VARCHAR(191) NOT NULL,

    PRIMARY KEY (`roleId`, `permissionId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `RoleApprovalLimit` (
    `id` VARCHAR(191) NOT NULL,
    `roleId` VARCHAR(191) NOT NULL,
    `actionType` VARCHAR(191) NOT NULL,
    `maxAmountKobo` BIGINT NULL,

    UNIQUE INDEX `RoleApprovalLimit_roleId_actionType_key`(`roleId`, `actionType`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `StaffUser` (
    `id` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `fullName` VARCHAR(191) NOT NULL,
    `phone` VARCHAR(191) NULL,
    `passwordHash` VARCHAR(191) NOT NULL,
    `passwordChangedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `mustChangePassword` BOOLEAN NOT NULL DEFAULT false,
    `roleId` VARCHAR(191) NOT NULL,
    `branchId` VARCHAR(191) NULL,
    `allBranches` BOOLEAN NOT NULL DEFAULT false,
    `status` ENUM('ACTIVE', 'DISABLED') NOT NULL DEFAULT 'ACTIVE',
    `totpSecretEnc` TEXT NULL,
    `totpEnabled` BOOLEAN NOT NULL DEFAULT false,
    `failedLoginCount` INTEGER NOT NULL DEFAULT 0,
    `lockedUntil` DATETIME(3) NULL,
    `lastLoginAt` DATETIME(3) NULL,
    `lastLoginIp` VARCHAR(191) NULL,
    `lastTotpStep` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `createdById` VARCHAR(191) NULL,

    UNIQUE INDEX `StaffUser_email_key`(`email`),
    INDEX `StaffUser_roleId_idx`(`roleId`),
    INDEX `StaffUser_branchId_idx`(`branchId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Session` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `tokenHash` VARCHAR(191) NOT NULL,
    `ip` VARCHAR(191) NULL,
    `userAgent` TEXT NULL,
    `deviceHash` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `lastActiveAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expiresAt` DATETIME(3) NOT NULL,
    `revokedAt` DATETIME(3) NULL,
    `revokedReason` VARCHAR(191) NULL,

    UNIQUE INDEX `Session_tokenHash_key`(`tokenHash`),
    INDEX `Session_userId_idx`(`userId`),
    INDEX `Session_expiresAt_idx`(`expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `LoginEvent` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NULL,
    `email` VARCHAR(191) NOT NULL,
    `ip` VARCHAR(191) NULL,
    `userAgent` TEXT NULL,
    `deviceHash` VARCHAR(191) NULL,
    `outcome` ENUM('SUCCESS', 'PASSWORD_OK_TOTP_PENDING', 'BAD_PASSWORD', 'BAD_TOTP', 'LOCKED', 'UNKNOWN_USER', 'DISABLED') NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `LoginEvent_userId_createdAt_idx`(`userId`, `createdAt`),
    INDEX `LoginEvent_createdAt_idx`(`createdAt`),
    INDEX `LoginEvent_ip_createdAt_idx`(`ip`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AuditLog` (
    `id` VARCHAR(191) NOT NULL,
    `seq` BIGINT NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `actorId` VARCHAR(191) NULL,
    `actorName` VARCHAR(191) NULL,
    `actorEmail` VARCHAR(191) NULL,
    `actorRole` VARCHAR(191) NULL,
    `action` VARCHAR(191) NOT NULL,
    `resourceType` VARCHAR(191) NOT NULL,
    `resourceId` VARCHAR(191) NULL,
    `before` JSON NULL,
    `after` JSON NULL,
    `ip` VARCHAR(191) NULL,
    `userAgent` TEXT NULL,
    `branchId` VARCHAR(191) NULL,
    `outcome` ENUM('SUCCESS', 'FAILURE', 'DENIED') NOT NULL DEFAULT 'SUCCESS',
    `metadata` JSON NULL,
    `prevHash` CHAR(64) NOT NULL,
    `hash` CHAR(64) NOT NULL,

    UNIQUE INDEX `AuditLog_seq_key`(`seq`),
    INDEX `AuditLog_createdAt_idx`(`createdAt`),
    INDEX `AuditLog_actorId_createdAt_idx`(`actorId`, `createdAt`),
    INDEX `AuditLog_resourceType_resourceId_idx`(`resourceType`, `resourceId`),
    INDEX `AuditLog_action_idx`(`action`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AuditChainHead` (
    `id` INTEGER NOT NULL,
    `lastSeq` BIGINT NOT NULL,
    `lastHash` CHAR(64) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ApprovalPolicy` (
    `type` VARCHAR(191) NOT NULL,
    `thresholdKobo` BIGINT NOT NULL DEFAULT 0,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`type`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ApprovalRequest` (
    `id` VARCHAR(191) NOT NULL,
    `type` VARCHAR(191) NOT NULL,
    `status` ENUM('PENDING', 'ESCALATED', 'EXECUTED', 'REJECTED', 'CANCELLED', 'FAILED') NOT NULL DEFAULT 'PENDING',
    `summary` VARCHAR(191) NOT NULL,
    `reason` VARCHAR(191) NULL,
    `amountKobo` BIGINT NULL,
    `payload` JSON NOT NULL,
    `makerId` VARCHAR(191) NOT NULL,
    `branchId` VARCHAR(191) NULL,
    `escalationLevel` INTEGER NOT NULL DEFAULT 0,
    `decidedAt` DATETIME(3) NULL,
    `executionResult` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `ApprovalRequest_status_type_idx`(`status`, `type`),
    INDEX `ApprovalRequest_makerId_idx`(`makerId`),
    INDEX `ApprovalRequest_branchId_idx`(`branchId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ApprovalStep` (
    `id` VARCHAR(191) NOT NULL,
    `requestId` VARCHAR(191) NOT NULL,
    `approverId` VARCHAR(191) NOT NULL,
    `approverRole` VARCHAR(191) NOT NULL,
    `approverLimitKobo` BIGINT NULL,
    `approverUnlimited` BOOLEAN NOT NULL DEFAULT false,
    `decision` ENUM('APPROVED', 'REJECTED', 'ESCALATED') NOT NULL,
    `comment` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ApprovalStep_requestId_idx`(`requestId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `NotificationTemplate` (
    `id` VARCHAR(191) NOT NULL,
    `key` VARCHAR(191) NOT NULL,
    `channel` ENUM('SMS', 'EMAIL', 'WHATSAPP', 'IN_APP') NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `subject` VARCHAR(191) NULL,
    `body` TEXT NOT NULL,
    `variables` JSON NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `NotificationTemplate_key_channel_key`(`key`, `channel`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `NotificationDelivery` (
    `id` VARCHAR(191) NOT NULL,
    `channel` ENUM('SMS', 'EMAIL', 'WHATSAPP', 'IN_APP') NOT NULL,
    `provider` VARCHAR(191) NOT NULL,
    `recipientMasked` VARCHAR(191) NOT NULL,
    `recipientHash` VARCHAR(191) NULL,
    `templateKey` VARCHAR(191) NULL,
    `bodyRedacted` TEXT NULL,
    `status` ENUM('QUEUED', 'SENT', 'DELIVERED', 'FAILED') NOT NULL DEFAULT 'QUEUED',
    `error` TEXT NULL,
    `providerMessageId` VARCHAR(191) NULL,
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `sentAt` DATETIME(3) NULL,

    INDEX `NotificationDelivery_channel_status_idx`(`channel`, `status`),
    INDEX `NotificationDelivery_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `InAppNotification` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `body` TEXT NOT NULL,
    `href` VARCHAR(191) NULL,
    `readAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `InAppNotification_userId_readAt_idx`(`userId`, `readAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SystemSetting` (
    `key` VARCHAR(191) NOT NULL,
    `namespace` VARCHAR(191) NOT NULL,
    `value` JSON NOT NULL,
    `description` VARCHAR(191) NULL,
    `updatedAt` DATETIME(3) NOT NULL,
    `updatedById` VARCHAR(191) NULL,

    INDEX `SystemSetting_namespace_idx`(`namespace`),
    PRIMARY KEY (`key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `LoanProduct` (
    `id` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `minAmountKobo` BIGINT NOT NULL,
    `maxAmountKobo` BIGINT NOT NULL,
    `monthlyRateBps` INTEGER NOT NULL,
    `minTenorMonths` INTEGER NOT NULL,
    `maxTenorMonths` INTEGER NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `LoanProduct_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Customer` (
    `id` VARCHAR(191) NOT NULL,
    `branchId` VARCHAR(191) NULL,
    `firstName` VARCHAR(191) NOT NULL,
    `lastName` VARCHAR(191) NOT NULL,
    `phoneEnc` TEXT NOT NULL,
    `phoneHash` VARCHAR(191) NOT NULL,
    `emailEnc` TEXT NULL,
    `emailHash` VARCHAR(191) NULL,
    `bvnEnc` TEXT NOT NULL,
    `bvnHash` VARCHAR(191) NOT NULL,
    `ninEnc` TEXT NULL,
    `ninHash` VARCHAR(191) NULL,
    `accountNumberEnc` TEXT NULL,
    `accountNumberHash` VARCHAR(191) NULL,
    `bankCode` VARCHAR(191) NULL,
    `state` VARCHAR(191) NULL,
    `employer` VARCHAR(191) NULL,
    `monthlyIncomeKobo` BIGINT NULL,
    `salaryDay` INTEGER NULL,
    `kycStatus` ENUM('PENDING', 'VERIFIED', 'REJECTED') NOT NULL DEFAULT 'PENDING',
    `retentionUntil` DATETIME(3) NULL,
    `erasedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Customer_phoneHash_key`(`phoneHash`),
    UNIQUE INDEX `Customer_bvnHash_key`(`bvnHash`),
    INDEX `Customer_branchId_idx`(`branchId`),
    INDEX `Customer_lastName_firstName_idx`(`lastName`, `firstName`),
    INDEX `Customer_emailHash_idx`(`emailHash`),
    INDEX `Customer_ninHash_idx`(`ninHash`),
    INDEX `Customer_accountNumberHash_idx`(`accountNumberHash`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Consent` (
    `id` VARCHAR(191) NOT NULL,
    `subjectType` VARCHAR(191) NOT NULL DEFAULT 'CUSTOMER',
    `subjectId` VARCHAR(191) NOT NULL,
    `purpose` VARCHAR(191) NOT NULL,
    `lawfulBasis` VARCHAR(191) NOT NULL DEFAULT 'CONSENT',
    `status` ENUM('GRANTED', 'REVOKED', 'EXPIRED') NOT NULL DEFAULT 'GRANTED',
    `textVersion` VARCHAR(191) NOT NULL,
    `channel` VARCHAR(191) NOT NULL DEFAULT 'WEB',
    `ip` VARCHAR(191) NULL,
    `userAgent` TEXT NULL,
    `grantedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `revokedAt` DATETIME(3) NULL,
    `expiresAt` DATETIME(3) NULL,
    `evidenceHash` VARCHAR(191) NULL,
    `recordedById` VARCHAR(191) NULL,
    `metadata` JSON NULL,

    INDEX `Consent_subjectType_subjectId_purpose_idx`(`subjectType`, `subjectId`, `purpose`),
    INDEX `Consent_status_expiresAt_idx`(`status`, `expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DataSubjectRequest` (
    `id` VARCHAR(191) NOT NULL,
    `customerId` VARCHAR(191) NOT NULL,
    `type` ENUM('ACCESS', 'RECTIFICATION', 'ERASURE', 'PORTABILITY', 'OBJECTION') NOT NULL,
    `status` ENUM('OPEN', 'IN_PROGRESS', 'COMPLETED', 'REJECTED') NOT NULL DEFAULT 'OPEN',
    `details` TEXT NULL,
    `dueAt` DATETIME(3) NOT NULL,
    `handledById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `closedAt` DATETIME(3) NULL,

    INDEX `DataSubjectRequest_status_dueAt_idx`(`status`, `dueAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `IdempotencyKey` (
    `id` VARCHAR(191) NOT NULL,
    `scope` VARCHAR(191) NOT NULL,
    `requestHash` VARCHAR(191) NOT NULL,
    `responseStatus` INTEGER NULL,
    `responseBody` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expiresAt` DATETIME(3) NOT NULL,

    INDEX `IdempotencyKey_expiresAt_idx`(`expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PortfolioSnapshot` (
    `id` VARCHAR(191) NOT NULL,
    `date` DATE NOT NULL,
    `disbursedKobo` BIGINT NOT NULL,
    `collectedKobo` BIGINT NOT NULL,
    `outstandingKobo` BIGINT NOT NULL,
    `dueKobo` BIGINT NOT NULL,
    `par1Bps` INTEGER NOT NULL,
    `par30Bps` INTEGER NOT NULL,
    `par90Bps` INTEGER NOT NULL,
    `activeBorrowers` INTEGER NOT NULL,
    `applications` INTEGER NOT NULL,
    `approvedCount` INTEGER NOT NULL,

    UNIQUE INDEX `PortfolioSnapshot_date_key`(`date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DemoDataset` (
    `key` VARCHAR(191) NOT NULL,
    `json` JSON NOT NULL,

    PRIMARY KEY (`key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `RolePermission` ADD CONSTRAINT `RolePermission_roleId_fkey` FOREIGN KEY (`roleId`) REFERENCES `Role`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RolePermission` ADD CONSTRAINT `RolePermission_permissionId_fkey` FOREIGN KEY (`permissionId`) REFERENCES `Permission`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RoleApprovalLimit` ADD CONSTRAINT `RoleApprovalLimit_roleId_fkey` FOREIGN KEY (`roleId`) REFERENCES `Role`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `StaffUser` ADD CONSTRAINT `StaffUser_roleId_fkey` FOREIGN KEY (`roleId`) REFERENCES `Role`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `StaffUser` ADD CONSTRAINT `StaffUser_branchId_fkey` FOREIGN KEY (`branchId`) REFERENCES `Branch`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Session` ADD CONSTRAINT `Session_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `StaffUser`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ApprovalRequest` ADD CONSTRAINT `ApprovalRequest_makerId_fkey` FOREIGN KEY (`makerId`) REFERENCES `StaffUser`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ApprovalStep` ADD CONSTRAINT `ApprovalStep_requestId_fkey` FOREIGN KEY (`requestId`) REFERENCES `ApprovalRequest`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ApprovalStep` ADD CONSTRAINT `ApprovalStep_approverId_fkey` FOREIGN KEY (`approverId`) REFERENCES `StaffUser`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `InAppNotification` ADD CONSTRAINT `InAppNotification_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `StaffUser`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Customer` ADD CONSTRAINT `Customer_branchId_fkey` FOREIGN KEY (`branchId`) REFERENCES `Branch`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DataSubjectRequest` ADD CONSTRAINT `DataSubjectRequest_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `Customer`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;


-- ───────── Audit log immutability (append-only) ─────────
-- NOTE: with binary logging on, creating triggers needs SUPER or --log-bin-trust-function-creators=1
-- (set in docker-compose). In production run migrations with a privileged migration user and give the
-- app user INSERT/SELECT only on AuditLog (no UPDATE/DELETE/TRUNCATE).
CREATE TRIGGER AuditLog_no_update BEFORE UPDATE ON `AuditLog` FOR EACH ROW
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'AuditLog is immutable';
CREATE TRIGGER AuditLog_no_delete BEFORE DELETE ON `AuditLog` FOR EACH ROW
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'AuditLog is immutable';
