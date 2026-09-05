CREATE TABLE "DailyAuditLog" (
	"id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	"accountId" integer NOT NULL,
	"date" text NOT NULL,
	"summary" text NOT NULL,
	"createdAt" text NOT NULL,
	"updatedAt" text NOT NULL,
	FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX "idx_daily_audit_account_date" ON "DailyAuditLog" ("accountId","date");--> statement-breakpoint
CREATE INDEX "idx_daily_audit_date" ON "DailyAuditLog" ("date");