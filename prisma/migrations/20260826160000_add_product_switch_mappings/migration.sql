-- CreateTable
CREATE TABLE "product_switch_mappings" (
    "id" TEXT NOT NULL,
    "source_product_name" TEXT,
    "source_pro_code" TEXT NOT NULL,
    "recommended_product_name" TEXT,
    "recommended_pro_code" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_switch_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "product_switch_mappings_source_pro_code_idx" ON "product_switch_mappings"("source_pro_code");

-- CreateIndex
CREATE INDEX "product_switch_mappings_recommended_pro_code_idx" ON "product_switch_mappings"("recommended_pro_code");
