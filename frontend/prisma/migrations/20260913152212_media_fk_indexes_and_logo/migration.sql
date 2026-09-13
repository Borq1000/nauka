-- CreateIndex
CREATE INDEX "Inquiry_serviceId_idx" ON "Inquiry"("serviceId");

-- CreateIndex
CREATE INDEX "Page_coverMediaId_idx" ON "Page"("coverMediaId");

-- CreateIndex
CREATE INDEX "Page_ogMediaId_idx" ON "Page"("ogMediaId");

-- CreateIndex
CREATE INDEX "Post_coverMediaId_idx" ON "Post"("coverMediaId");

-- CreateIndex
CREATE INDEX "Post_ogMediaId_idx" ON "Post"("ogMediaId");

-- CreateIndex
CREATE INDEX "Service_coverMediaId_idx" ON "Service"("coverMediaId");

-- CreateIndex
CREATE INDEX "Service_ogMediaId_idx" ON "Service"("ogMediaId");

-- AddForeignKey
ALTER TABLE "SiteSettings" ADD CONSTRAINT "SiteSettings_logoMediaId_fkey" FOREIGN KEY ("logoMediaId") REFERENCES "Media"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
