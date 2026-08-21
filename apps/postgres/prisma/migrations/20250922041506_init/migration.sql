-- CreateTable
CREATE TABLE "public"."onboarding_submission" (
    "id" TEXT NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "date_of_birth" TIMESTAMP(3) NOT NULL,
    "address_line_1" TEXT NOT NULL,
    "address_line_2" TEXT,
    "town" TEXT NOT NULL,
    "postcode" TEXT NOT NULL,
    "role_type" TEXT NOT NULL,
    "role_other" TEXT,
    "submitted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "onboarding_submission_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "onboarding_submission_submitted_at_idx" ON "public"."onboarding_submission"("submitted_at");
