CREATE TABLE `Account` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`nit` text NOT NULL,
	`email` text NOT NULL,
	`phone` text,
	`address` text,
	`subscriptionStatus` text DEFAULT 'TRIAL' NOT NULL,
	`subscriptionPlan` text DEFAULT 'BASIC' NOT NULL,
	`trialEndsAt` text,
	`stripeCustomerId` text,
	`dianResolution` text,
	`dianPrefix` text DEFAULT 'FV',
	`isActive` integer DEFAULT true NOT NULL,
	`createdAt` text NOT NULL,
	`updatedAt` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `Account_nit_unique` ON `Account` (`nit`);--> statement-breakpoint
CREATE TABLE `AuditLog` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`accountId` integer,
	`userId` integer NOT NULL,
	`action` text NOT NULL,
	`entity` text NOT NULL,
	`entityId` integer,
	`payload` text,
	`createdAt` text NOT NULL,
	FOREIGN KEY (`accountId`) REFERENCES `Account`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_audit_created` ON `AuditLog` (`createdAt`);--> statement-breakpoint
CREATE INDEX `idx_audit_user_created` ON `AuditLog` (`userId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `idx_audit_action` ON `AuditLog` (`action`);--> statement-breakpoint
CREATE INDEX `idx_audit_entity` ON `AuditLog` (`entity`);--> statement-breakpoint
CREATE INDEX `idx_audit_account` ON `AuditLog` (`accountId`);--> statement-breakpoint
CREATE TABLE `BranchStock` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`branchId` integer NOT NULL,
	`productId` integer NOT NULL,
	`stock` real DEFAULT 0 NOT NULL,
	`minStock` integer DEFAULT 5 NOT NULL,
	`criticalStock` integer DEFAULT 2 NOT NULL,
	`location` text,
	`expiryDate` text,
	FOREIGN KEY (`branchId`) REFERENCES `Branch`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`productId`) REFERENCES `Product`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_branchstock_branch_product` ON `BranchStock` (`branchId`,`productId`);--> statement-breakpoint
CREATE INDEX `idx_branchstock_branch` ON `BranchStock` (`branchId`);--> statement-breakpoint
CREATE INDEX `idx_branchstock_product` ON `BranchStock` (`productId`);--> statement-breakpoint
CREATE TABLE `Branch` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`accountId` integer NOT NULL,
	`name` text NOT NULL,
	`code` text NOT NULL,
	`address` text,
	`phone` text,
	`isActive` integer DEFAULT true NOT NULL,
	`createdAt` text NOT NULL,
	`updatedAt` text NOT NULL,
	FOREIGN KEY (`accountId`) REFERENCES `Account`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_branch_account_code` ON `Branch` (`accountId`,`code`);--> statement-breakpoint
CREATE INDEX `idx_branch_account` ON `Branch` (`accountId`);--> statement-breakpoint
CREATE TABLE `CashExpense` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`accountId` integer,
	`cashSessionId` integer NOT NULL,
	`userId` integer NOT NULL,
	`amount` real NOT NULL,
	`reason` text NOT NULL,
	`createdAt` text NOT NULL,
	FOREIGN KEY (`accountId`) REFERENCES `Account`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`cashSessionId`) REFERENCES `CashSession`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_cashexpense_session` ON `CashExpense` (`cashSessionId`);--> statement-breakpoint
CREATE INDEX `idx_cashexpense_account` ON `CashExpense` (`accountId`);--> statement-breakpoint
CREATE TABLE `CashSession` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`accountId` integer,
	`userId` integer NOT NULL,
	`branchId` integer,
	`initialCash` real NOT NULL,
	`finalCash` real,
	`expectedCash` real,
	`difference` real,
	`openedAt` text NOT NULL,
	`closedAt` text,
	`status` text DEFAULT 'OPEN' NOT NULL,
	FOREIGN KEY (`accountId`) REFERENCES `Account`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`branchId`) REFERENCES `Branch`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_cashsession_status` ON `CashSession` (`status`);--> statement-breakpoint
CREATE INDEX `idx_cashsession_branch` ON `CashSession` (`branchId`);--> statement-breakpoint
CREATE INDEX `idx_cashsession_user` ON `CashSession` (`userId`);--> statement-breakpoint
CREATE INDEX `idx_cashsession_account` ON `CashSession` (`accountId`);--> statement-breakpoint
CREATE TABLE `Category` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`accountId` integer,
	`name` text NOT NULL,
	`color` text,
	`createdAt` text NOT NULL,
	`updatedAt` text NOT NULL,
	FOREIGN KEY (`accountId`) REFERENCES `Account`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_category_account_name` ON `Category` (`accountId`,`name`);--> statement-breakpoint
CREATE TABLE `Config` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`accountId` integer,
	`key` text NOT NULL,
	`value` text NOT NULL,
	`updatedAt` text NOT NULL,
	FOREIGN KEY (`accountId`) REFERENCES `Account`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_config_account_key` ON `Config` (`accountId`,`key`);--> statement-breakpoint
CREATE TABLE `Customer` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`accountId` integer,
	`document` text,
	`name` text NOT NULL,
	`email` text,
	`phone` text,
	`address` text,
	`isActive` integer DEFAULT true NOT NULL,
	`createdAt` text NOT NULL,
	`updatedAt` text NOT NULL,
	FOREIGN KEY (`accountId`) REFERENCES `Account`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_customer_account_document` ON `Customer` (`accountId`,`document`);--> statement-breakpoint
CREATE TABLE `Debt` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`accountId` integer,
	`customerId` integer NOT NULL,
	`saleId` integer,
	`branchId` integer,
	`amount` real NOT NULL,
	`balance` real NOT NULL,
	`status` text DEFAULT 'PENDING' NOT NULL,
	`createdAt` text NOT NULL,
	`updatedAt` text NOT NULL,
	FOREIGN KEY (`accountId`) REFERENCES `Account`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`customerId`) REFERENCES `Customer`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`saleId`) REFERENCES `Sale`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`branchId`) REFERENCES `Branch`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_debt_customer` ON `Debt` (`customerId`);--> statement-breakpoint
CREATE INDEX `idx_debt_status` ON `Debt` (`status`);--> statement-breakpoint
CREATE INDEX `idx_debt_customer_status` ON `Debt` (`customerId`,`status`);--> statement-breakpoint
CREATE TABLE `Invoice` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`saleId` integer NOT NULL,
	`accountId` integer NOT NULL,
	`cufe` text NOT NULL,
	`dianStatus` text DEFAULT 'PENDING' NOT NULL,
	`dianResponse` text,
	`pdfUrl` text,
	`xmlUrl` text,
	`sentAt` text,
	`validatedAt` text,
	FOREIGN KEY (`saleId`) REFERENCES `Sale`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`accountId`) REFERENCES `Account`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `Invoice_cufe_unique` ON `Invoice` (`cufe`);--> statement-breakpoint
CREATE INDEX `idx_invoice_account` ON `Invoice` (`accountId`);--> statement-breakpoint
CREATE INDEX `idx_invoice_sale` ON `Invoice` (`saleId`);--> statement-breakpoint
CREATE TABLE `Payment` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`saleId` integer,
	`debtId` integer,
	`cashSessionId` integer,
	`method` text NOT NULL,
	`amount` real NOT NULL,
	`reference` text,
	`createdAt` text NOT NULL,
	FOREIGN KEY (`saleId`) REFERENCES `Sale`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`debtId`) REFERENCES `Debt`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`cashSessionId`) REFERENCES `CashSession`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_payment_sale` ON `Payment` (`saleId`);--> statement-breakpoint
CREATE INDEX `idx_payment_cashsession` ON `Payment` (`cashSessionId`);--> statement-breakpoint
CREATE INDEX `idx_payment_method` ON `Payment` (`method`);--> statement-breakpoint
CREATE TABLE `Product` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`accountId` integer,
	`code` text NOT NULL,
	`barcode` text,
	`name` text NOT NULL,
	`description` text,
	`categoryId` integer,
	`price` real NOT NULL,
	`cost` real NOT NULL,
	`stock` real DEFAULT 0 NOT NULL,
	`minStock` integer DEFAULT 5 NOT NULL,
	`criticalStock` integer DEFAULT 2 NOT NULL,
	`taxRate` real DEFAULT 0.19 NOT NULL,
	`suggestedPurchaseQty` integer,
	`expiryDate` text,
	`location` text,
	`unitType` text DEFAULT 'UNIT' NOT NULL,
	`conversionFactor` real DEFAULT 1 NOT NULL,
	`isActive` integer DEFAULT true NOT NULL,
	`createdAt` text NOT NULL,
	`updatedAt` text NOT NULL,
	FOREIGN KEY (`accountId`) REFERENCES `Account`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`categoryId`) REFERENCES `Category`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_product_active_name` ON `Product` (`isActive`,`name`);--> statement-breakpoint
CREATE INDEX `idx_product_category` ON `Product` (`categoryId`);--> statement-breakpoint
CREATE INDEX `idx_product_active_category` ON `Product` (`isActive`,`categoryId`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_product_account_barcode` ON `Product` (`accountId`,`barcode`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_product_account_code` ON `Product` (`accountId`,`code`);--> statement-breakpoint
CREATE TABLE `PurchaseOrderItem` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`orderId` integer NOT NULL,
	`productId` integer NOT NULL,
	`quantityOrdered` real NOT NULL,
	`quantityReceived` real DEFAULT 0 NOT NULL,
	`unitCost` real NOT NULL,
	`total` real NOT NULL,
	`received` integer DEFAULT false NOT NULL,
	`observations` text,
	FOREIGN KEY (`orderId`) REFERENCES `PurchaseOrder`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`productId`) REFERENCES `Product`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_poitem_order` ON `PurchaseOrderItem` (`orderId`);--> statement-breakpoint
CREATE INDEX `idx_poitem_product` ON `PurchaseOrderItem` (`productId`);--> statement-breakpoint
CREATE TABLE `PurchaseOrder` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`accountId` integer,
	`orderNumber` text NOT NULL,
	`supplierId` integer NOT NULL,
	`branchId` integer,
	`status` text DEFAULT 'DRAFT' NOT NULL,
	`subtotal` real DEFAULT 0 NOT NULL,
	`tax` real DEFAULT 0 NOT NULL,
	`freight` real DEFAULT 0 NOT NULL,
	`total` real DEFAULT 0 NOT NULL,
	`expectedDate` text,
	`receivedDate` text,
	`observations` text,
	`notes` text,
	`userId` integer NOT NULL,
	`createdAt` text NOT NULL,
	`updatedAt` text NOT NULL,
	FOREIGN KEY (`accountId`) REFERENCES `Account`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`supplierId`) REFERENCES `Supplier`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`branchId`) REFERENCES `Branch`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_purchase_supplier` ON `PurchaseOrder` (`supplierId`);--> statement-breakpoint
CREATE INDEX `idx_purchase_status` ON `PurchaseOrder` (`status`);--> statement-breakpoint
CREATE INDEX `idx_purchase_created` ON `PurchaseOrder` (`createdAt`);--> statement-breakpoint
CREATE INDEX `idx_purchase_branch` ON `PurchaseOrder` (`branchId`);--> statement-breakpoint
CREATE TABLE `SaleItem` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`saleId` integer NOT NULL,
	`productId` integer NOT NULL,
	`quantity` real NOT NULL,
	`unitPrice` real NOT NULL,
	`taxRate` real NOT NULL,
	`subtotal` real NOT NULL,
	`discount` real DEFAULT 0 NOT NULL,
	`total` real DEFAULT 0 NOT NULL,
	`unitType` text NOT NULL,
	FOREIGN KEY (`saleId`) REFERENCES `Sale`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`productId`) REFERENCES `Product`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_saleitem_sale` ON `SaleItem` (`saleId`);--> statement-breakpoint
CREATE INDEX `idx_saleitem_product` ON `SaleItem` (`productId`);--> statement-breakpoint
CREATE TABLE `Sale` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`accountId` integer,
	`saleNumber` text NOT NULL,
	`userId` integer NOT NULL,
	`cashSessionId` integer,
	`branchId` integer,
	`subtotal` real NOT NULL,
	`tax` real NOT NULL,
	`discount` real DEFAULT 0 NOT NULL,
	`deliveryFee` real DEFAULT 0 NOT NULL,
	`total` real NOT NULL,
	`change` real DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'COMPLETED' NOT NULL,
	`customerId` integer,
	`cufe` text,
	`dianStatus` text DEFAULT 'PENDING',
	`createdAt` text NOT NULL,
	FOREIGN KEY (`accountId`) REFERENCES `Account`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`cashSessionId`) REFERENCES `CashSession`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`branchId`) REFERENCES `Branch`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`customerId`) REFERENCES `Customer`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_sale_created` ON `Sale` (`createdAt`);--> statement-breakpoint
CREATE INDEX `idx_sale_status_created` ON `Sale` (`status`,`createdAt`);--> statement-breakpoint
CREATE INDEX `idx_sale_cashsession` ON `Sale` (`cashSessionId`);--> statement-breakpoint
CREATE INDEX `idx_sale_user_created` ON `Sale` (`userId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `idx_sale_customer` ON `Sale` (`customerId`);--> statement-breakpoint
CREATE INDEX `idx_sale_branch` ON `Sale` (`branchId`);--> statement-breakpoint
CREATE INDEX `idx_sale_account` ON `Sale` (`accountId`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_sale_number` ON `Sale` (`saleNumber`);--> statement-breakpoint
CREATE TABLE `Session` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`userId` integer NOT NULL,
	`token` text NOT NULL,
	`expiresAt` text NOT NULL,
	`createdAt` text NOT NULL,
	`closedAt` text,
	FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `Session_token_unique` ON `Session` (`token`);--> statement-breakpoint
CREATE INDEX `idx_session_user` ON `Session` (`userId`);--> statement-breakpoint
CREATE INDEX `idx_session_expires` ON `Session` (`expiresAt`);--> statement-breakpoint
CREATE TABLE `StockMovement` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`accountId` integer,
	`productId` integer NOT NULL,
	`type` text NOT NULL,
	`quantity` real NOT NULL,
	`previousStock` real NOT NULL,
	`newStock` real NOT NULL,
	`reason` text,
	`userId` integer NOT NULL,
	`branchId` integer,
	`createdAt` text NOT NULL,
	FOREIGN KEY (`accountId`) REFERENCES `Account`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`productId`) REFERENCES `Product`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`branchId`) REFERENCES `Branch`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_stockmovement_product` ON `StockMovement` (`productId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `idx_stockmovement_user` ON `StockMovement` (`userId`);--> statement-breakpoint
CREATE INDEX `idx_stockmovement_branch` ON `StockMovement` (`branchId`);--> statement-breakpoint
CREATE INDEX `idx_stockmovement_account` ON `StockMovement` (`accountId`);--> statement-breakpoint
CREATE TABLE `Subscription` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`accountId` integer NOT NULL,
	`stripeSubscriptionId` text,
	`plan` text NOT NULL,
	`status` text NOT NULL,
	`startsAt` text NOT NULL,
	`endsAt` text,
	`createdAt` text NOT NULL,
	FOREIGN KEY (`accountId`) REFERENCES `Account`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `Supplier` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`accountId` integer,
	`name` text NOT NULL,
	`contactPerson` text,
	`phone` text NOT NULL,
	`email` text,
	`address` text,
	`leadTimeDays` integer DEFAULT 7 NOT NULL,
	`isActive` integer DEFAULT true NOT NULL,
	`notes` text,
	`createdAt` text NOT NULL,
	`updatedAt` text NOT NULL,
	FOREIGN KEY (`accountId`) REFERENCES `Account`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `User` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`accountId` integer,
	`username` text NOT NULL,
	`password` text NOT NULL,
	`fullName` text NOT NULL,
	`role` text DEFAULT 'CASHIER' NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`mustChangePassword` integer DEFAULT false NOT NULL,
	`hourlyRate` real,
	`failedLoginAttempts` integer DEFAULT 0 NOT NULL,
	`lockedUntil` text,
	`branchId` integer,
	`createdAt` text NOT NULL,
	`updatedAt` text NOT NULL,
	FOREIGN KEY (`accountId`) REFERENCES `Account`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`branchId`) REFERENCES `Branch`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_user_account_username` ON `User` (`accountId`,`username`);