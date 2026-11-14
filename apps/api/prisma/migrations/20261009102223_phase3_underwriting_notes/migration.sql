-- CreateTable
CREATE TABLE `UnderwritingNote` (
    `id` VARCHAR(191) NOT NULL,
    `applicationId` VARCHAR(191) NOT NULL,
    `authorId` VARCHAR(191) NULL,
    `authorName` VARCHAR(191) NOT NULL,
    `kind` VARCHAR(191) NOT NULL DEFAULT 'NOTE',
    `body` TEXT NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `UnderwritingNote_applicationId_createdAt_idx`(`applicationId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
