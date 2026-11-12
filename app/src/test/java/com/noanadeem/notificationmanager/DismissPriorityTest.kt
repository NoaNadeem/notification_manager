package com.noanadeem.notificationmanager
import org.junit.Assert.*
import org.junit.Test
class DismissPriorityTest {
 @Test fun completionClearsPriorityAndUndoRestoresOnlyAnUnchangedTitle() {
  for(title in listOf("Synthetic.","Synthetic ★","Synthetic (pri)")) {
   assertEquals("Synthetic",completionPriorityTitle(title,true,title))
   assertNull(completionPriorityTitle("Synthetic",true,title))
   assertEquals(title,completionPriorityTitle("Synthetic",false,title))
   assertNull(completionPriorityTitle("Edited elsewhere",false,title))
   assertNull(completionPriorityTitle(title,false,title))
  }
  assertNull(completionPriorityTitle("Plain title",true,"Plain title"))
  assertNull(completionPriorityTitle("Plain title",false,null))
 }
}
