-- Phase 2: add MANUAL origin for user-created edges
ALTER TYPE "EdgeOrigin" ADD VALUE IF NOT EXISTS 'MANUAL';
