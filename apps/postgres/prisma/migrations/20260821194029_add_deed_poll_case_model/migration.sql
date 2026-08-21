-- CreateEnum
CREATE TYPE "DeedPollType" AS ENUM ('Adult', 'AdultTransgender', 'Minor', 'MinorTransgender', 'DeedOfRelinquishment', 'Unknown');

-- CreateEnum
CREATE TYPE "DeedPollState" AS ENUM ('Received', 'ReadyForMaster', 'ReferredToMaster', 'Enroled', 'Returned', 'AwaitingFurtherDocs', 'AwaitingSignature', 'AwaitingEnrolment');

-- CreateEnum
CREATE TYPE "MaritalStatus" AS ENUM ('Single', 'MarriedCivilPartnership', 'Widowed', 'DivorcedDissolved');

-- CreateEnum
CREATE TYPE "Privacy" AS ENUM ('Normal', 'Private');

-- CreateEnum
CREATE TYPE "Urgency" AS ENUM ('Normal', 'Urgent');

-- CreateEnum
CREATE TYPE "PostCounter" AS ENUM ('Counter', 'Online', 'Post', 'Unknown');

-- CreateEnum
CREATE TYPE "Nationality" AS ENUM ('BritishCitizen', 'BritishDependantTerritoriesCitizen', 'CommonwealthCitizen', 'Unknown');

-- CreateEnum
CREATE TYPE "NationalitySection" AS ENUM ('Section1', 'Section11', 'Section37', 'Section6', 'Unknown', 'NoneOfTheAbove');

-- CreateEnum
CREATE TYPE "MasterDecision" AS ENUM ('Approved', 'Rejected');

-- CreateEnum
CREATE TYPE "ReferToMaster" AS ENUM ('Yes', 'No');

-- CreateEnum
CREATE TYPE "DocumentDirection" AS ENUM ('Incoming', 'Outgoing');

-- CreateTable
CREATE TABLE "deedpoll_deedpoll" (
    "id" TEXT NOT NULL,
    "referencenumber" INTEGER,
    "displayReference" TEXT,
    "type" "DeedPollType",
    "state" "DeedPollState",
    "privacy" "Privacy" NOT NULL DEFAULT 'Normal',
    "urgency" "Urgency" NOT NULL DEFAULT 'Normal',
    "urgencyreason" TEXT,
    "postCounter" "PostCounter",
    "inPerson" BOOLEAN,
    "migratedRecord" BOOLEAN NOT NULL DEFAULT false,
    "retainPermanently" BOOLEAN NOT NULL DEFAULT false,
    "maritalStatus" "MaritalStatus",
    "feeReference" TEXT,
    "onlineApplicationReference" TEXT,
    "newForename" VARCHAR(1000),
    "newMiddleName" VARCHAR(1000),
    "newSurname" VARCHAR(1000),
    "oldForename" VARCHAR(1000),
    "oldMiddleName" VARCHAR(1000),
    "oldSurname" VARCHAR(1000),
    "applicantBuildingNoName" TEXT,
    "applicantEmail" TEXT,
    "applicantTelephone" TEXT,
    "applicantAddress1" TEXT,
    "applicantAddress2" TEXT,
    "applicantTownCity" TEXT,
    "applicantPostcode" TEXT,
    "representativeName" TEXT,
    "representativeBuildingNoName" TEXT,
    "representativeCompany" TEXT,
    "representativeAddress1" TEXT,
    "representativeEmail" TEXT,
    "representativeAddress2" TEXT,
    "representativeTelephone" TEXT,
    "representativeTownCity" TEXT,
    "representativePostcode" TEXT,
    "ageOfMinor" INTEGER,
    "ageOfMinorMonths" INTEGER,
    "minorDateOfBirth" TIMESTAMP(3),
    "parents" TEXT,
    "placeOfBirth" VARCHAR(100),
    "nationalitySubject" VARCHAR(20),
    "nationalitySectionProvenance" VARCHAR(30),
    "parentRelationship" VARCHAR(100),
    "parentAddress1" VARCHAR(100),
    "parentAddress2" VARCHAR(100),
    "parentTownCity" VARCHAR(100),
    "parentPostcode" VARCHAR(10),
    "parentCountry" VARCHAR(100),
    "secondParentName" VARCHAR(1000),
    "secondParentRelationship" VARCHAR(100),
    "nationality" "Nationality",
    "nationalitySection" "NationalitySection",
    "nationalitySectionOther" TEXT,
    "iShall" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "iHaveSubscribed" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "andAlsoMyOld" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "dateOfDeclaration" TIMESTAMP(3),
    "dateOfApplication" TIMESTAMP(3),
    "dateReceived" TIMESTAMP(3),
    "awaitingFurtherDocsInfo" TIMESTAMP(3),
    "signatureRequestedDate" TIMESTAMP(3),
    "signaturerecieveddate" TIMESTAMP(3),
    "dateReadyForMaster" TIMESTAMP(3),
    "dateReferred" TIMESTAMP(3),
    "dateEnroled" TIMESTAMP(3),
    "dateReturned" TIMESTAMP(3),
    "dateNoticeSentToLondonGazette" TIMESTAMP(3),
    "referToMasterChoice" "ReferToMaster",
    "masterName" TEXT,
    "masterDirections" TEXT,
    "masterDecision" "MasterDecision",
    "masterDateOfDecision" TIMESTAMP(3),
    "dateDecisionDirectionsReceived" TIMESTAMP(3),
    "referralNotes" TEXT,
    "publishToLondonGazette" BOOLEAN NOT NULL DEFAULT true,
    "returnReason" TEXT,
    "refundAmount" DECIMAL(12,2),
    "dateOfRefund" TIMESTAMP(3),
    "refundReference" TEXT,
    "createdOn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modifiedOn" TIMESTAMP(3) NOT NULL,
    "createdBy" VARCHAR(200),
    "modifiedBy" VARCHAR(200),

    CONSTRAINT "deedpoll_deedpoll_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deedpoll_notes" (
    "id" TEXT NOT NULL,
    "deedPollId" TEXT NOT NULL,
    "note" VARCHAR(2000) NOT NULL,
    "createdBy" VARCHAR(200),
    "modifiedBy" VARCHAR(200),
    "createdOn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modifiedOn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "deedpoll_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deedpoll_witness" (
    "id" TEXT NOT NULL,
    "deedPollId" TEXT NOT NULL,
    "witnessName" VARCHAR(100) NOT NULL,
    "witnessAddress" VARCHAR(250) NOT NULL,
    "witnessOccupation" VARCHAR(100) NOT NULL,
    "declarant" BOOLEAN NOT NULL,
    "createdOn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modifiedOn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "deedpoll_witness_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deedpoll_supportingdocumenttype" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "applicableMaritalStatuses" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "applicableTypes" INTEGER[] DEFAULT ARRAY[]::INTEGER[],

    CONSTRAINT "deedpoll_supportingdocumenttype_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deedpoll_referencecounter" (
    "year" INTEGER NOT NULL,
    "lastSerial" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "deedpoll_referencecounter_pkey" PRIMARY KEY ("year")
);

-- CreateTable
CREATE TABLE "deedpoll_supportingdocument" (
    "id" TEXT NOT NULL,
    "deedPollId" TEXT NOT NULL,
    "direction" "DocumentDirection" NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "documentTypeId" TEXT NOT NULL,
    "storageKey" TEXT,
    "originalName" TEXT,
    "mimeType" TEXT,
    "sizeBytes" INTEGER,
    "createdOn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modifiedOn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "deedpoll_supportingdocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "deedpoll_deedpoll_displayReference_key" ON "deedpoll_deedpoll"("displayReference");

-- CreateIndex
CREATE INDEX "deedpoll_deedpoll_state_idx" ON "deedpoll_deedpoll"("state");

-- CreateIndex
CREATE INDEX "deedpoll_deedpoll_type_idx" ON "deedpoll_deedpoll"("type");

-- CreateIndex
CREATE INDEX "deedpoll_deedpoll_dateReceived_idx" ON "deedpoll_deedpoll"("dateReceived");

-- CreateIndex
CREATE INDEX "deedpoll_notes_deedPollId_idx" ON "deedpoll_notes"("deedPollId");

-- CreateIndex
CREATE INDEX "deedpoll_witness_deedPollId_idx" ON "deedpoll_witness"("deedPollId");

-- CreateIndex
CREATE INDEX "deedpoll_supportingdocument_deedPollId_idx" ON "deedpoll_supportingdocument"("deedPollId");

-- AddForeignKey
ALTER TABLE "deedpoll_notes" ADD CONSTRAINT "deedpoll_notes_deedPollId_fkey" FOREIGN KEY ("deedPollId") REFERENCES "deedpoll_deedpoll"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deedpoll_witness" ADD CONSTRAINT "deedpoll_witness_deedPollId_fkey" FOREIGN KEY ("deedPollId") REFERENCES "deedpoll_deedpoll"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deedpoll_supportingdocument" ADD CONSTRAINT "deedpoll_supportingdocument_deedPollId_fkey" FOREIGN KEY ("deedPollId") REFERENCES "deedpoll_deedpoll"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deedpoll_supportingdocument" ADD CONSTRAINT "deedpoll_supportingdocument_documentTypeId_fkey" FOREIGN KEY ("documentTypeId") REFERENCES "deedpoll_supportingdocumenttype"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
