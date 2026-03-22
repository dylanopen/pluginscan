/**
 * modules/classAnalyzer.js
 * ─────────────────────────────────────────────────────────────────
 * Walks a flat Instruction[] produced by the disassembler and
 * produces a MethodInfo[] — one entry per method in the class.
 *
 * Each MethodInfo contains the list of *calls* that method makes,
 * derived from invoke* opcodes in its bytecode body.
 *
 * Exported types (as plain objects — no classes needed here):
 *
 *   MethodInfo {
 *     key:           string       // unique key  "name:descriptor"
 *     name:          string       // display name (simple class name for constructors)
 *     descriptor:    string       // raw JVM descriptor e.g. "(ILjava/lang/String;)V"
 *     returnType:    string       // e.g. "void"
 *     paramTypes:    string[]     // e.g. ["int", "String"]
 *     accessFlags:   number
 *     isConstructor: boolean
 *     isStaticInit:  boolean
 *     calls:         CallSite[]
 *   }
 *
 *   CallSite {
 *     mnemonic:    string   // invokevirtual | invokespecial | invokestatic | invokeinterface | invokedynamic
 *     owner:       string   // declaring class, e.g. "java.io.PrintStream"
 *     methodName:  string   // e.g. "println"
 *     descriptor:  string   // e.g. "(Ljava/lang/String;)V"
 *     display:     string   // human label shown in the UI
 *   }
 */

import { InstructionKind } from './decompiler/Instruction.js';

// Opcodes that represent a method call
const INVOKE_MNEMONICS = new Set([
  'invokevirtual',
  'invokespecial',
  'invokestatic',
  'invokeinterface',
  'invokedynamic',
]);

/**
 * Build a MethodInfo[] from a flat Instruction[].
 *
 * @param {import('./decompiler/Instruction.js').Instruction[]} instructions
 * @returns {MethodInfo[]}
 */
export function analyzeClass(instructions) {
  const methods = [];
  let current   = null;

  for (const insn of instructions) {
    switch (insn.kind) {

      case InstructionKind.METHOD_DEF:
        current = {
          key:           `${insn.name}:${insn.descriptor}`,
          name:          insn.name,
          descriptor:    insn.descriptor,
          returnType:    insn.returnType,
          paramTypes:    insn.paramTypes ?? [],
          accessFlags:   insn.accessFlags,
          isConstructor: insn.isConstructor,
          isStaticInit:  insn.isStaticInit,
          calls:         [],
        };
        break;

      case InstructionKind.OPCODE:
        if (current && INVOKE_MNEMONICS.has(insn.mnemonic)) {
          const callSite = parseCallSite(insn.mnemonic, insn.operand);
          if (callSite) current.calls.push(callSite);
        }
        break;

      case InstructionKind.METHOD_END:
        if (current) {
          methods.push(current);
          current = null;
        }
        break;
    }
  }

  return methods;
}

// ── Internal helpers ──────────────────────────────────────────────

/**
 * The disassembler renders operands as a resolved string like:
 *   "java.io.PrintStream.println (Ljava/lang/String;)V"
 *   "java.lang.StringBuilder.<init> ()V"
 *
 * We parse that string back into structured parts.
 */
function parseCallSite(mnemonic, operand) {
  if (!operand || typeof operand !== 'string') {
    return { mnemonic, owner: '?', methodName: '?', descriptor: '', display: operand ?? mnemonic };
  }

  // invokedynamic operands look different — just keep them as-is
  if (mnemonic === 'invokedynamic') {
    return { mnemonic, owner: 'dynamic', methodName: operand, descriptor: '', display: operand };
  }

  // Expected format: "some.Class.methodName (Ldesc;)V"
  // Split on the first space before the descriptor
  const spaceIdx = operand.indexOf(' ');
  const refPart  = spaceIdx >= 0 ? operand.slice(0, spaceIdx)  : operand;
  const descPart = spaceIdx >= 0 ? operand.slice(spaceIdx + 1) : '';

  // refPart = "some.fully.Qualified.methodName"
  const lastDot    = refPart.lastIndexOf('.');
  const owner      = lastDot >= 0 ? refPart.slice(0, lastDot)  : '?';
  const methodName = lastDot >= 0 ? refPart.slice(lastDot + 1) : refPart;

  const ownerSimple = owner.split('.').pop() || owner;
  const display     = methodName === '<init>'
    ? `new ${ownerSimple}()`
    : `${ownerSimple}.${methodName}()`;

  return { mnemonic, owner, methodName, descriptor: descPart, display };
}
