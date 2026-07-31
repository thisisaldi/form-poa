-- Which medical specialties each product is recommended for (see Product.spesialisasiRekomendasi doc comment)
ALTER TABLE "Product" ADD COLUMN "spesialisasiRekomendasi" TEXT[] NOT NULL DEFAULT '{}';
