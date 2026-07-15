import assert from 'node:assert/strict';
import test from 'node:test';
import { isPhoneResourceProfile } from '../src/lib/client-resources';
import { adjacentPdfPage, pdfPageScrollTop, pdfSpreadStart } from '../src/lib/pdf-navigation';

test('advances whole facing-page spreads', () => {
  assert.equal(pdfSpreadStart(3,true),2);
  assert.equal(adjacentPdfPage(1,1,12,true),2);
  assert.equal(adjacentPdfPage(3,1,12,true),4);
  assert.equal(adjacentPdfPage(4,-1,12,true),2);
  assert.equal(adjacentPdfPage(2,-1,12,true),1);
  assert.equal(adjacentPdfPage(4,1,5,true),5);
});

test('uses layout offsets once when navigating a zoomed PDF', () => {
  assert.equal(pdfPageScrollTop(800,.5,8),392);
  assert.equal(pdfPageScrollTop(800,2,8),1592);
});

test('enables the reduced resource profile only for coarse-pointer phones', () => {
  const iphone='Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)';
  const androidPhone='Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Mobile Safari/537.36';
  const androidTablet='Mozilla/5.0 (Linux; Android 15; Pixel Tablet) AppleWebKit/537.36 Safari/537.36';
  assert.equal(isPhoneResourceProfile(iphone,true),true);
  assert.equal(isPhoneResourceProfile(androidPhone,true),true);
  assert.equal(isPhoneResourceProfile(androidTablet,true),false);
  assert.equal(isPhoneResourceProfile(iphone,false),false);
});

