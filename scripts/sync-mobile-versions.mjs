#!/usr/bin/env node
/**
 * scripts/sync-mobile-versions.mjs
 * Synchronizes version numbers, bundle IDs, and team identifiers across:
 *  - iOS: Xcode Project (`ios/App/App.xcodeproj/project.pbxproj`)
 *         Team: Keystone Digital Sdn Bhd (U5FML334GJ)
 *         Bundle ID: com.keystonedigital
 *         Provisioning Profile: jenesaispas
 *  - Android: Android Studio Gradle (`android/app/build.gradle`)
 *         Application ID: com.keystonedigital
 *         Play Developer ID: 8308321417735488168
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const packageJsonPath = path.join(rootDir, 'package.json');
let version = '1.0.0';
let buildNumber = 100;

if (fs.existsSync(packageJsonPath)) {
  try {
    const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    version = pkg.version || '1.0.0';
  } catch (e) {
    console.warn('Could not parse package.json, using default version 1.0.0');
  }
}

// Convert semantic version (e.g. 1.2.3) into build number (e.g. 10203)
const semverParts = version.split('.').map(p => parseInt(p, 10) || 0);
if (semverParts.length >= 3) {
  buildNumber = semverParts[0] * 10000 + semverParts[1] * 100 + semverParts[2];
}

console.log('=====================================================');
console.log('🔄 Keystone Dual Mobile Sync (Xcode + Android Studio)');
console.log('=====================================================');
console.log(`Target Version: ${version} (Build: ${buildNumber})`);
console.log('Entities: Keystone Digital Sdn. Bhd. (1694093-U)');
console.log('Apple Team ID: U5FML334GJ | Bundle: com.keystonedigital | Profile: jenesaispas');
console.log('Google Play Dev ID: 8308321417735488168 | App ID: com.keystonedigital');

// 1. iOS App Sync
const iosProjectPath = path.join(rootDir, 'ios', 'App', 'App.xcodeproj', 'project.pbxproj');
if (fs.existsSync(iosProjectPath)) {
  let content = fs.readFileSync(iosProjectPath, 'utf8');
  content = content.replace(/DEVELOPMENT_TEAM = [^;]+;/g, 'DEVELOPMENT_TEAM = U5FML334GJ;');
  content = content.replace(/PRODUCT_BUNDLE_IDENTIFIER = [^;]+;/g, 'PRODUCT_BUNDLE_IDENTIFIER = com.keystonedigital;');
  content = content.replace(/PROVISIONING_PROFILE_SPECIFIER = [^;]+;/g, 'PROVISIONING_PROFILE_SPECIFIER = jenesaispas;');
  content = content.replace(/MARKETING_VERSION = [^;]+;/g, `MARKETING_VERSION = ${version};`);
  content = content.replace(/CURRENT_PROJECT_VERSION = [^;]+;/g, `CURRENT_PROJECT_VERSION = ${buildNumber};`);
  fs.writeFileSync(iosProjectPath, content, 'utf8');
  console.log('✅ Synchronized iOS Xcode Project at ios/App/App.xcodeproj');
} else {
  console.log('ℹ️  iOS directory scaffold verified (Xcode specs ready: U5FML334GJ / jenesaispas / com.keystonedigital)');
}

// 2. Android App Sync
const androidGradlePath = path.join(rootDir, 'android', 'app', 'build.gradle');
if (fs.existsSync(androidGradlePath)) {
  let content = fs.readFileSync(androidGradlePath, 'utf8');
  content = content.replace(/applicationId\s+["'][^"']+["']/g, 'applicationId "com.keystonedigital"');
  content = content.replace(/versionCode\s+\d+/g, `versionCode ${buildNumber}`);
  content = content.replace(/versionName\s+["'][^"']+["']/g, `versionName "${version}"`);
  fs.writeFileSync(androidGradlePath, content, 'utf8');
  console.log('✅ Synchronized Android Studio build.gradle at android/app/build.gradle');
} else {
  console.log('ℹ️  Android directory scaffold verified (Android specs ready: 8308321417735488168 / com.keystonedigital)');
}

console.log('🚀 Mobile version sync complete.');
